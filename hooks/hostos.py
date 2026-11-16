#!/usr/bin/env python3
"""What differs between macOS, Linux (WSL too) and Windows, kept in small functions that can be tested on any machine.

Used by collect.py (process list, memory) and by the pane itself:
  hostos.py power      -> one JSON line {"pct": 0-100 | null, "charging": bool} (Linux, Windows; macOS reads pmset itself)
  hostos.py proc <pid> -> '<etime> <command>' like `ps -p <pid> -o etime=,command=`, exit 1 when there is no such process
                          (the check before stopping a job, on Linux and Windows)
The parse_* and decode_* functions take text or numbers and return plain values; only the read_* functions touch the system."""
import calendar, json, os, re, shlex, subprocess, sys, time

IS_WIN = sys.platform.startswith('win')
IS_MAC = sys.platform == 'darwin'
# Windows: helpers we start must not open a console window of their own
NO_WINDOW = 0x08000000 if IS_WIN else 0


def sh(argv, timeout=5):
    try:
        if IS_WIN:
            r = subprocess.run(argv, capture_output=True, timeout=timeout, creationflags=NO_WINDOW)
            return r.stdout.decode('utf-8', 'replace')
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ''


def utf8_stdout():
    # Windows: a pipe's default encoding is the ANSI code page, which cannot write Korean labels. macOS and Linux keep theirs
    if IS_WIN:
        try: sys.stdout.reconfigure(encoding='utf-8')
        except Exception: pass


def etime_s(t):
    """ps etime '[[dd-]hh:]mm:ss' -> seconds"""
    d, _, hms = t.rpartition('-'); p = [int(x) for x in hms.split(':')]
    while len(p) < 3: p.insert(0, 0)
    return (int(d) if d else 0) * 86400 + p[0] * 3600 + p[1] * 60 + p[2]


def etime_of(s):
    """seconds -> ps etime ('mm:ss', 'hh:mm:ss', 'dd-hh:mm:ss')"""
    s = max(0, int(s)); d, s = divmod(s, 86400); h, s = divmod(s, 3600); m, s = divmod(s, 60)
    if d: return '%d-%02d:%02d:%02d' % (d, h, m, s)
    if h: return '%02d:%02d:%02d' % (h, m, s)
    return '%02d:%02d' % (m, s)


# ── macOS and other ps systems ───────────────────────────────────────────────

def parse_ps(out):
    """`ps -xo pid=,ppid=,etime=,rss=,command=` -> [(pid, ppid, elapsed_s, rss_kb, command)]; odd lines are skipped"""
    rows = []
    for ln in out.splitlines():
        m = re.match(r'\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)', ln)
        if not m: continue
        try: rows.append((int(m[1]), int(m[2]), etime_s(m[3]), int(m[4]), m[5]))
        except ValueError: continue
    return rows


def read_ps():
    # -x: 이 사용자의 프로세스만(터미널이 없는 것도). 다른 사용자의 작업은 보지도, 중지하지도 않는다
    return parse_ps(sh(['ps', '-xo', 'pid=,ppid=,etime=,rss=,command=']))


# ── Linux (/proc) ────────────────────────────────────────────────────────────

PROC = '/proc'


def has_proc(root=PROC):
    return os.path.exists(os.path.join(root, 'self', 'stat'))


def parse_proc_stat(text):
    """/proc/<pid>/stat -> (ppid, starttime_ticks, rss_pages). The name in brackets may hold spaces and brackets"""
    rest = text[text.rindex(')') + 2:].split()
    # rest[0] is field 3 (state): ppid = field 4, starttime = field 22, rss = field 24
    return int(rest[1]), int(rest[19]), int(rest[21])


def parse_cmdline(raw):
    """/proc/<pid>/cmdline (NUL between arguments) -> the command as `ps` prints it: arguments joined by spaces"""
    return ' '.join(a.decode('utf-8', 'replace') for a in raw.rstrip(b'\0').split(b'\0')) if raw.strip(b'\0') else ''


def read_proc(root=PROC, uid=None, hz=None, page_kb=None, uptime=None):
    """Like read_ps, from /proc: this user's processes with a command line (no kernel threads)"""
    uid = os.geteuid() if uid is None else uid
    hz = hz or os.sysconf('SC_CLK_TCK')
    page_kb = page_kb or os.sysconf('SC_PAGE_SIZE') // 1024
    if uptime is None:
        with open(os.path.join(root, 'uptime')) as f: uptime = float(f.read().split()[0])
    rows = []
    for name in os.listdir(root):
        if not name.isdigit(): continue
        d = os.path.join(root, name)
        try:
            if os.stat(d).st_uid != uid: continue
            with open(os.path.join(d, 'stat')) as f: ppid, start, rss = parse_proc_stat(f.read())
            with open(os.path.join(d, 'cmdline'), 'rb') as f: cmd = parse_cmdline(f.read())
        except (OSError, ValueError, IndexError):
            continue  # 그 사이에 끝난 프로세스
        if cmd: rows.append((int(name), ppid, max(0, int(uptime - start / hz)), rss * page_kb, cmd))
    return rows


def proc_link(pid, what, root=PROC):
    """readlink of /proc/<pid>/<what> ('cwd', 'fd/1'), only when it is a path ('' for pipes, sockets, closed)"""
    try: p = os.readlink(os.path.join(root, str(pid), what))
    except OSError: return ''
    return p if p.startswith('/') and not p.endswith(' (deleted)') else ''


def proc_log(pid, root=PROC):
    # stdout 이 일반 파일일 때만 로그로 본다(터미널 /dev/pts/N 을 읽으면 입력을 기다리며 멈춘다)
    p = proc_link(pid, 'fd/1', root)
    return p if p and os.path.isfile(p) else ''


def parse_meminfo(text):
    """/proc/meminfo -> {'freePct', 'swapUsedGB', 'swapTotalGB'}: free % = MemAvailable / MemTotal"""
    kb = {}
    for ln in text.splitlines():
        m = re.match(r'(\w+):\s+(\d+)', ln)
        if m: kb[m[1]] = int(m[2])
    mem = {'freePct': None}
    total = kb.get('MemTotal')
    avail = kb.get('MemAvailable', (kb.get('MemFree', 0) + kb.get('Buffers', 0) + kb.get('Cached', 0)) if 'MemFree' in kb else None)
    if total and avail is not None: mem['freePct'] = int(round(100 * avail / total))
    if 'SwapTotal' in kb and 'SwapFree' in kb:
        mem['swapUsedGB'] = round((kb['SwapTotal'] - kb['SwapFree']) / 1048576, 1)
        mem['swapTotalGB'] = round(kb['SwapTotal'] / 1048576, 1)
    return mem


def linux_battery(base='/sys/class/power_supply'):
    """First system battery: BAT*, or any supply of type Battery that is not a device's (mouse, headset)"""
    def rd(*p):
        try:
            with open(os.path.join(base, *p)) as f: return f.read().strip()
        except OSError: return ''
    try: names = sorted(os.listdir(base))
    except OSError: return {'pct': None, 'charging': False}
    for n in names:
        if not (n.startswith('BAT') or (rd(n, 'type') == 'Battery' and rd(n, 'scope') != 'Device')): continue
        cap = rd(n, 'capacity')
        if not cap.isdigit(): continue
        return {'pct': min(100, int(cap)), 'charging': rd(n, 'status').lower() == 'charging'}
    return {'pct': None, 'charging': False}


# ── Windows ──────────────────────────────────────────────────────────────────

def win_split(cmdline):
    """A Windows command line -> argv, by the rules of CommandLineToArgvW / the C runtime:
    the program name ends at the closing quote or a space; then 2n backslashes + '"' -> n backslashes and a quote toggle,
    2n+1 backslashes + '"' -> n backslashes and a literal '"', other backslashes are literal, '""' inside quotes is a '"'."""
    s, i, n, argv = cmdline, 0, len(cmdline), []
    while i < n and s[i] in ' \t': i += 1
    if i >= n: return argv
    if s[i] == '"':
        j = s.find('"', i + 1); j = n if j < 0 else j
        argv.append(s[i + 1:j]); i = j + 1
    else:
        j = i
        while j < n and s[j] not in ' \t': j += 1
        argv.append(s[i:j]); i = j
    while True:
        while i < n and s[i] in ' \t': i += 1
        if i >= n: return argv
        cur, quoted = [], False
        while i < n and (quoted or s[i] not in ' \t'):
            if s[i] == '\\':
                j = i
                while j < n and s[j] == '\\': j += 1
                k = j - i
                if j < n and s[j] == '"':
                    cur.append('\\' * (k // 2))
                    if k % 2: cur.append('"'); i = j + 1
                    else: i = j
                else:
                    cur.append('\\' * k); i = j
            elif s[i] == '"':
                if quoted and i + 1 < n and s[i + 1] == '"': cur.append('"'); i += 2
                else: quoted = not quoted; i += 1
            else:
                cur.append(s[i]); i += 1
        argv.append(''.join(cur))


def win_base(path):
    """'C:\\x\\codex.cmd' -> 'codex': file name, lower case, without .exe/.cmd/.bat/.ps1/.js/.mjs/.cjs"""
    b = re.split(r'[\\/]', path)[-1].lower()
    return re.sub(r'\.(exe|cmd|bat|ps1|js|mjs|cjs)$', '', b)


def win_command(cmdline):
    """A Windows command line -> the command as `ps` would print it on macOS for the same job, so that collect.py and the
    pane (hooks/proc.ts kindMatches) use one set of rules: 'codex exec …' / 'agy -p …'.
    Wrappers are taken off: `node.exe …\\codex.js exec` and `codex.cmd exec` / `codex.exe exec` become `codex exec`,
    `agy.exe -p` becomes `agy -p`. The arguments keep their exact text (joined with POSIX quoting where needed)."""
    argv = win_split(cmdline or '')
    if not argv: return ''
    if win_base(argv[0]) in ('node', 'bun') and len(argv) > 1:
        i = 1
        while i < len(argv) and argv[i].startswith('-'): i += 1  # node 의 옵션(--no-warnings 등)
        if i < len(argv) and win_base(argv[i]) in ('codex', 'agy'): argv = argv[i:]
    b = win_base(argv[0])
    if b in ('codex', 'agy'): argv = [b] + argv[1:]
    return ' '.join(shlex.quote(a) if a == '' or re.search(r'[\s\'"\\$`]', a) else a for a in argv)


def parse_win_date(v, now=None):
    """Win32_Process.CreationDate as PowerShell may write it -> epoch seconds (None when unreadable):
    ISO 8601 ('2026-11-17T01:02:03.1234567Z', with an offset or none = UTC), '/Date(1731800000000)/' (ms, an offset suffix
    does not change the instant), WMI DMTF ('20261117100203.123456+540', local time + offset minutes), or a number."""
    if isinstance(v, (int, float)) and not isinstance(v, bool): return float(v)
    if not isinstance(v, str): return None
    s = v.strip()
    m = re.match(r'^[\\/]*Date\((-?\d+)(?:[+-]\d{4})?\)[\\/]*$', s)
    if m: return int(m[1]) / 1000.0
    m = re.match(r'^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?\s*(Z|[+-]\d\d:?\d\d)?$', s)
    if m:
        t = calendar.timegm((int(m[1]), int(m[2]), int(m[3]), int(m[4]), int(m[5]), int(m[6]), 0, 0, 0))
        t += float('0.' + m[7]) if m[7] else 0.0
        z = m[8]
        if z and z != 'Z':
            sign = -1 if z[0] == '-' else 1; hh, mm = int(z[1:3]), int(z[-2:])
            t -= sign * (hh * 3600 + mm * 60)
        return t
    m = re.match(r'^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(?:\.(\d+))?([+-]\d+)$', s)
    if m:
        t = calendar.timegm((int(m[1]), int(m[2]), int(m[3]), int(m[4]), int(m[5]), int(m[6]), 0, 0, 0))
        t += float('0.' + m[7]) if m[7] else 0.0
        return t - int(m[8]) * 60
    return None


# One PowerShell call for the process list: only processes whose command line mentions codex or agy (small output),
# only this user's (like `ps -x`; a process whose owner cannot be read is kept), and the start time as ISO 8601 UTC.
# Sent with -EncodedCommand so no quoting of the script can go wrong. {filter} is a WQL filter.
WIN_PS_LIST = r"""$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ps = @(Get-CimInstance Win32_Process -Filter "{filter}" | Where-Object {{ $_.CommandLine }} | Where-Object {{
  $o = Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid
  -not $o.Sid -or $o.Sid -eq $me
}} | ForEach-Object {{ [pscustomobject]@{{
  ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; CommandLine = $_.CommandLine
  WorkingSetSize = $_.WorkingSetSize
  CreationDate = if ($_.CreationDate) {{ $_.CreationDate.ToUniversalTime().ToString('o') }} else {{ $null }}
}} }})
if ($ps.Count) {{ ConvertTo-Json -InputObject $ps -Compress }}
"""
WIN_FILTER_JOBS = "CommandLine LIKE '%codex%' OR CommandLine LIKE '%agy%'"


def win_ps_argv(filt):
    import base64
    script = WIN_PS_LIST.format(filter=filt)
    return ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-EncodedCommand', base64.b64encode(script.encode('utf-16-le')).decode('ascii')]


def parse_win_procs(out, now=None):
    """The JSON of the PowerShell call (one object, a list, or nothing) -> [(pid, ppid, elapsed_s, rss_kb, command)],
    the command normalised by win_command. Entries without a command line or a readable start time are skipped."""
    now = time.time() if now is None else now
    s = (out or '').strip().lstrip('\ufeff')
    if not s: return []
    try: data = json.loads(s)
    except ValueError: return []
    if isinstance(data, dict): data = [data]
    if not isinstance(data, list): return []
    rows = []
    for o in data:
        if not isinstance(o, dict): continue
        cmd, pid = o.get('CommandLine'), o.get('ProcessId')
        start = parse_win_date(o.get('CreationDate'))
        if not isinstance(cmd, str) or not cmd or not isinstance(pid, int) or start is None: continue
        ppid = o.get('ParentProcessId') if isinstance(o.get('ParentProcessId'), int) else 0
        ws = o.get('WorkingSetSize') if isinstance(o.get('WorkingSetSize'), (int, float)) else 0
        rows.append((pid, ppid, max(0, int(now - start)), int(ws) // 1024, win_command(cmd)))
    return rows


def read_win_procs(filt=WIN_FILTER_JOBS, timeout=15):
    return parse_win_procs(sh(win_ps_argv(filt), timeout))


def outermost(rows, matched):
    """Of the matched pids, those whose parent is not itself matched: on Windows `node codex.js exec` starts `codex.exe exec`,
    and both look like the same job. The outer one is kept (stopping it with taskkill /T ends both)."""
    ppid = {r[0]: r[1] for r in rows}
    return {p for p in matched if ppid.get(p) not in matched}


def decode_mem_status(total_phys, avail_phys, total_page, avail_page):
    """GlobalMemoryStatusEx numbers (bytes) -> {'freePct', 'swapUsedGB', 'swapTotalGB'}.
    The page-file numbers are the commit limit (RAM + page files), so swap = what is beyond RAM: total = limit - RAM,
    used = committed - RAM in use, kept between 0 and total. Rough, but enough to say 'swap is filling up'."""
    mem = {'freePct': int(round(100 * avail_phys / total_phys)) if total_phys else None}
    gb = 1 << 30
    sw_total = max(0, total_page - total_phys)
    sw_used = max(0, min(sw_total, (total_page - avail_page) - (total_phys - avail_phys)))
    mem['swapUsedGB'], mem['swapTotalGB'] = round(sw_used / gb, 1), round(sw_total / gb, 1)
    return mem


def decode_power_status(ac_line, flag, percent):
    """GetSystemPowerStatus -> {'pct', 'charging'}. No system battery (flag 128) or unknown (255) -> pct None.
    charging only while it charges (flag bit 8), as macOS shows 'charging' and not 'AC attached' or 'charged'."""
    if flag == 255 or flag & 128 or percent > 100: return {'pct': None, 'charging': False}
    return {'pct': int(percent), 'charging': bool(flag & 8)}


def read_win_mem():
    import ctypes
    class MEMORYSTATUSEX(ctypes.Structure):
        _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong), ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong), ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong), ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
    st = MEMORYSTATUSEX(); st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st)): return {'freePct': None}
    return decode_mem_status(st.ullTotalPhys, st.ullAvailPhys, st.ullTotalPageFile, st.ullAvailPageFile)


def read_win_power():
    import ctypes
    class SYSTEM_POWER_STATUS(ctypes.Structure):
        _fields_ = [('ACLineStatus', ctypes.c_ubyte), ('BatteryFlag', ctypes.c_ubyte), ('BatteryLifePercent', ctypes.c_ubyte),
                    ('SystemStatusFlag', ctypes.c_ubyte), ('BatteryLifeTime', ctypes.c_ulong), ('BatteryFullLifeTime', ctypes.c_ulong)]
    st = SYSTEM_POWER_STATUS()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(st)): return {'pct': None, 'charging': False}
    return decode_power_status(st.ACLineStatus, st.BatteryFlag, st.BatteryLifePercent)


# ── what collect.py and the pane call ────────────────────────────────────────

def read_procs():
    """This user's processes as [(pid, ppid, elapsed_s, rss_kb, command)] on this OS (Windows: only codex/agy candidates)"""
    if IS_WIN: return read_win_procs()
    if not IS_MAC and has_proc():
        try: return read_proc()
        except OSError: pass
    return read_ps()


def read_mem():
    """{'freePct', 'swapUsedGB'?, 'swapTotalGB'?, 'load', 'cpus'} on Linux and Windows (macOS: collect.py reads its own tools).
    Windows has no load average: load is None and the pane leaves it out."""
    mem = {'freePct': None}
    if IS_WIN:
        try: mem = read_win_mem()
        except Exception: pass
        mem['load'] = None
    else:
        try:
            with open('/proc/meminfo') as f: mem = parse_meminfo(f.read())
        except OSError: pass
        try: mem['load'] = os.getloadavg()[0]
        except (OSError, AttributeError): mem['load'] = None
    mem['cpus'] = os.cpu_count()
    return mem


def read_power():
    if IS_WIN:
        try: return read_win_power()
        except Exception: return {'pct': None, 'charging': False}
    return linux_battery()


def proc_line(pid, rows):
    """The `ps -p <pid> -o etime=,command=` line for pid from read_procs-style rows, or '' when it is not there"""
    for r in rows:
        if r[0] == pid: return '%s %s' % (etime_of(r[2]), r[4])
    return ''


def read_one(pid):
    if IS_WIN: return read_win_procs('ProcessId=%d' % pid, 10)
    if not IS_MAC and has_proc():
        d = os.path.join(PROC, str(pid))
        try: return [r for r in read_proc() if r[0] == pid] if os.path.isdir(d) else []
        except OSError: return []
    return parse_ps(sh(['ps', '-p', str(pid), '-o', 'pid=,ppid=,etime=,rss=,command=']))


def main(args):
    utf8_stdout()
    if args[:1] == ['power']:
        print(json.dumps(read_power())); return 0
    if args[:1] == ['proc'] and len(args) == 2 and args[1].isdigit():
        line = proc_line(int(args[1]), read_one(int(args[1])))
        if line: print(line)
        return 0 if line else 1
    print('usage: hostos.py power | proc <pid>', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
