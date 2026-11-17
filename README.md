# status-panel

A side pane for Claude Code in the terminal. While you chat, it shows the time, your Claude and Codex usage limits and the jobs you have running, with Clawd, a pixel mascot that reacts to what Claude is doing.

> Unofficial fan project, not affiliated with or endorsed by Anthropic. Clawd is Anthropic's character; see [Clawd artwork](#clawd-artwork).

[한국어](README.ko.md)

![The pane while Claude fixes a bug: Clawd thinks, works, reads, waits for your answer and celebrates, under the Claude and Codex usage limits](https://github.com/TayonKim/claude-code-status-panel/releases/download/v0.8.1/demo.gif)

## What it shows

- Clock, date and battery.
- Claude and Codex usage limits: how much is left in each window, when it resets, and your pace against an even burn: on pace, N% reserve, or N% deficit (with when you'd run out at this rate).
- Clawd, animated to match what Claude is doing: thinking, working, a question mark when a permission prompt or a question is waiting for you, a flinch when a tool call fails, and dozing off late at night. Your computer's free memory and load sit beside it.
- Running `codex exec` jobs and Antigravity CLI (`agy -p`) jobs, plus interactive `agy` sessions and queued jobs, with model, effort and elapsed time. Click a job (or press 1–9) to see the end of its log or stop it.
- Recently finished jobs, with a toast when each one ends.
- The last 7 days: how long Claude worked and how many tokens it used (input, cache writes and output; cache reads are not counted), with a strip that shades each day by working time.
- A playground of small Clawds at the bottom (in terminals that draw images: kitty, Ghostty or iTerm2). The sky follows the time of day, with shooting stars and fireflies at night and birds and butterflies by day.

The pane never calls a model and uses no tokens. It reads local information on a timer; the only network request is Codex's own usage check (see [Privacy](#privacy)).

## Requirements

- An operating system:
  - macOS: full support. Battery and memory come from `pmset`, `memory_pressure` and `sysctl`.
  - Linux and WSL: supported. Jobs, memory and load come from `/proc`, the battery from `/sys/class/power_supply` (hidden on desktops).
  - Windows: experimental, tested only with simulated inputs. Jobs come from one PowerShell call (`Get-CimInstance Win32_Process`), memory and battery from Windows itself; there is no load figure and no log tail for `codex exec` jobs (an `agy --log-file` log still shows). Windows Terminal gets the text mode described below.
- Claude Code 2.1.325 or later.
- Python 3: `python3`, or on Windows `python` or `py` (the pane tries `python3`, then `python`, then `py -3`, and skips the Microsoft Store placeholder). On macOS, if it's missing, run `xcode-select --install`.
- Optional: a terminal that draws images (kitty, Ghostty, or iTerm2 3.5 or later), to draw Clawd, the clock, the 7-day strip and the playground as pictures. Other terminals get Clawd in half-block characters (when the pane is at least 38 columns wide), a text clock, a text 7-day strip and no playground.
- Optional: the Codex CLI, signed in, for Codex usage.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install status-panel --marketplace TayonKim/claude-code-status-panel
```

Answer `y` to add the marketplace, then choose a scope. The pane opens by itself when the terminal is wide enough (from about 110–144 columns, depending on Claude Code's layout). In a narrower terminal, run `/status-panel`.

To remove it: `/plugin uninstall status-panel`.

### Updating

```
claude plugin update status-panel@claude-code-status-panel
```

Then run `/reload-plugins` at the Claude Code prompt. The new version only takes effect after the reload. If the pane looks wrong afterwards, restart Claude Code.

The same applies when you change the plugin's files directly (for example, copying a fresh checkout over the plugin folder): run `/reload-plugins` afterwards.

## Commands

| Command | What it does |
|---|---|
| `/status-panel` | Open the pane |
| `/status-panel lang en` · `ko` · `auto` | Set the language. `auto` follows your locale (`LC_ALL`, then `LC_MESSAGES`, then `LANG`): Korean when it starts with `ko`, English otherwise |
| `/clawd` · `/clawd on` · `/clawd off` | Toggle Clawd, or turn it on or off |
| `/clawd plain` · `/clawd sticker` | Set Clawd's look: plain (no outline) or sticker (outlined) |
| `/clawd yard` · `/clawd yard on` · `/clawd yard off` | Toggle or set the playground |
| `/clawd bg` · `/clawd bg on` · `/clawd bg off` | Toggle or set the playground background |

Settings persist across sessions.

## Privacy

Everything is read on your computer:

- Jobs: your running processes and their command lines (macOS `ps`, Linux `/proc`, Windows PowerShell `Get-CimInstance`), and the log files and folders of running jobs (macOS `lsof`, Linux `/proc`).
- Battery and memory (macOS `pmset`, `memory_pressure`, `sysctl`; Linux `/proc/meminfo` and `/sys/class/power_supply`; Windows `GlobalMemoryStatusEx` and `GetSystemPowerStatus`).
- The last 7 days: Claude Code's own transcript files in `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`), using only timestamps, token counts and whether a line is a prompt you typed. The conversation text is never stored or shown.
- Claude usage: from Claude Code itself.
- Codex usage: from your local `codex app-server`, under the Codex account you're signed in to, about every 5 minutes and when a job finishes (or when you run `/status-panel`). Codex makes that request to OpenAI and keeps its usual logs for it.
- Nothing is sent anywhere else.
- Settings are kept in Claude Code's plugin storage.
- The only file the pane writes is `~/.cache/status-panel/week.json` (readable only by you). For each transcript file it holds the path, how far it has been read, its daily totals and the IDs of its last few responses, so that a repeated response is counted once.
- The developer tuning file `~/.claude/status-panel-tune.json` is read only if it exists.

## Clawd artwork

`clawd/sprites.json` is fan-made pixel art of Clawd, Anthropic's mascot, based on Anthropic's official Clawd stickers. It is not covered by this repository's MIT license, and the character belongs to Anthropic. It will be taken down on request.

## Development

```
claude plugin validate .
claude plugin test .
python3 -I -B tests/week_test.py
python3 -I -B tests/platform_test.py
```

The Python tests also run on GitHub Actions on Ubuntu, macOS and Windows.

For tuning while developing, a JSON file at `~/.claude/status-panel-tune.json` is read every 5 seconds if it exists. `{ "debug": true }` adds a line with the row counts at the top of the pane.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). The Clawd artwork is not; see [Clawd artwork](#clawd-artwork).
