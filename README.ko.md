# status-panel

터미널의 Claude Code 대화 옆에 붙는 패널이에요. 대화하는 동안 시계, Claude·Codex 사용량 한도, 돌고 있는 작업을 보여 주고, Claude 가 하는 일에 반응하는 도트 마스코트 Clawd 가 같이 있어요.

> Anthropic·닌텐도 등 권리자와 관계없는 비공식 팬 프로젝트예요. Clawd 와 테마 캐릭터는 각 권리자의 것이에요. [그림](#그림)을 봐 주세요.

[English](README.md)

![Claude 가 버그를 고치는 동안의 패널: Clawd 가 생각하고, 일하고, 읽고, 내 대답을 기다리고, 끝나면 기뻐해요. 위에는 Claude·Codex 사용량 한도](https://github.com/TayonKim/status-panel/releases/download/v0.8.1/demo.gif)

## 보여 주는 것

- 시계, 날짜, 배터리.
- Claude·Codex 사용량 한도: 기간마다 남은 양, 리셋까지 남은 시간, 고르게 쓸 때와 견준 사용 속도(정상 속도·N% 여유·N% 부족, 부족하면 이 속도로 바닥나는 때도).
- Claude 가 하는 일에 맞춰 움직이는 Clawd: 생각하고 일하다가, 권한 확인이나 질문이 내 대답을 기다리면 물음표를 띄우고, 도구가 실패하면 움찔하고, 밤늦게는 꾸벅꾸벅 졸아요. 옆에 이 컴퓨터의 남은 메모리와 부하.
- 돌고 있는 `codex exec` 작업과 Antigravity CLI(`agy -p`) 작업, 손으로 띄운 대화형 `agy`, 기다리는 작업: 모델, effort, 걸린 시간. 작업을 누르면(또는 1–9) 로그 끝부분을 보거나 작업을 멈출 수 있어요.
- 최근 끝난 작업. 끝날 때마다 알림이 떠요.
- 최근 7일: Claude 가 일한 시간과 쓴 토큰(입력·캐시 쓰기·출력, 캐시 읽기는 세지 않아요), 날마다 일한 시간만큼 진해지는 잔디 칸.
- 맨 아래 작은 Clawd 들의 풍경(그림을 그리는 터미널에서만: kitty, Ghostty, iTerm2). 하늘은 시간에 따라 바뀌고, 밤에는 별똥별과 반딧불이, 낮에는 새와 나비가 지나가요.

패널은 모델을 부르지 않아서 토큰이 들지 않아요. 컴퓨터 안의 정보를 주기적으로 읽고, 네트워크 요청은 Codex 가 스스로 하는 사용량 확인 하나뿐이에요([개인정보](#개인정보) 참고).

## Clawd 의 16가지 모습

Clawd 는 Claude 가 하는 일에 따라 16가지 모습으로 바뀌어요. 파일을 고칠 때는 마술봉, 서브에이전트가 일할 때는 망토, 내 대답을 기다릴 때는 물음표를 들어요.

![Clawd 의 16가지 모습과 각각 언제 나오는지](https://github.com/TayonKim/status-panel/releases/download/v0.8.2/moods_ko.gif)

## 테마

`/skin` 으로 Clawd 대신 다른 캐릭터를 고를 수 있어요: 커비, 마리오, 포켓몬. 큰 캐릭터와 아래 풍경이 같이 바뀌어요. 마리오·포켓몬 테마에서는 몇몇 동작에서 같은 게임의 친구가 반쯤 확률로 대신 나와요.

## 필요한 것

- 운영체제:
  - macOS: 모두 돼요. 배터리·메모리를 `pmset`, `memory_pressure`, `sysctl` 로 읽어요.
  - Linux·WSL: 지원해요. 작업·메모리·부하는 `/proc`, 배터리는 `/sys/class/power_supply` 에서 읽어요(데스크톱은 배터리 칸이 빠져요).
  - Windows: 시험판이에요. 흉내 낸 입력으로만 시험했어요. 작업은 PowerShell 한 번(`Get-CimInstance Win32_Process`), 메모리·배터리는 Windows 에서 바로 읽어요. 부하 수치가 없고 `codex exec` 작업의 로그 끝부분도 못 봐요(`agy --log-file` 로그는 보여요). Windows Terminal 에서는 아래의 글자 화면이에요.
- Claude Code 2.1.325 이상.
- 파이썬 3: `python3`, Windows 에서는 `python` 이나 `py` 도 돼요(`python3` → `python` → `py -3` 차례로 찾고, Microsoft Store 의 빈 바로 가기는 건너뛰어요). macOS 에서 없으면 `xcode-select --install` 로 넣어요.
- (선택) 그림을 그리는 터미널(kitty, Ghostty, iTerm2 3.5 이상). Clawd·시계·최근 7일 잔디·풍경을 그림으로 그려요. 다른 터미널에서는 Clawd 가 반 블록 글자로(패널 폭이 38칸 이상일 때), 시계와 최근 7일 잔디가 글자로 바뀌고 풍경은 빠져요.
- (선택) 로그인된 Codex CLI. Codex 사용량에 써요.

## 설치

Claude Code 터미널 세션의 입력창에서:

```
/plugin install status-panel --marketplace TayonKim/status-panel
```

마켓플레이스를 추가할지 물으면 `y`, 그다음 범위를 골라요. 터미널이 넉넉하면(Claude Code 화면 배치에 따라 가로 약 110~144칸부터) 패널이 저절로 열려요. 더 좁은 터미널에서는 `/status-panel` 로 열어요.

지우기: `/plugin uninstall status-panel`

### 새 버전으로 올리기

```
claude plugin update status-panel@status-panel
```

그다음 Claude Code 입력창에서 `/reload-plugins` 를 실행해요. 이걸 해야 새 버전이 적용돼요. 다시 불러온 뒤 패널이 이상하면 Claude Code 를 껐다 켜요.

예전 이름(TayonKim/claude-code-status-panel)으로 설치했다면 예전 업데이트 명령이 그대로 돼요: `claude plugin update status-panel@claude-code-status-panel`

플러그인 폴더의 파일을 직접 바꿨을 때(받은 저장소를 폴더에 덮어쓴 경우 등)도 같아요. 바꾼 뒤 `/reload-plugins` 를 실행해요.

## 명령

| 명령 | 하는 일 |
|---|---|
| `/status-panel` | 패널 열기 |
| `/status-panel 언어` · `언어 자동\|영어\|한국어` | 화면 언어 고르기 창, 또는 바로 정하기(`language auto\|english\|korean` 도 돼요). `자동`은 로캘을 따라요(`LC_ALL` → `LC_MESSAGES` → `LANG` 순서로 보고 `ko` 로 시작하면 한국어, 아니면 영어) |
| `/clawd` · `/clawd 켜기` · `/clawd 끄기` | Clawd 켜기·끄기 전환, 또는 켜거나 끄기 |
| `/scene` · `/scene 끄기\|작게\|크게` | 맨 아래 풍경 고르기 창, 또는 바로 정하기. 작게: 작은 Clawd 와 바닥 선만. 크게(기본): 하늘·언덕·구름·나무까지. Clawd 를 꺼도 남아요 |
| `/skin` · `/skin <이름>` | 테마를 고르거나 바로 정해요: `clawd`, `커비`, `마리오`, `포켓몬` |

고른 것은 다음 세션에도 남아요.

## 개인정보

모두 이 컴퓨터 안에서 읽어요.

- 작업: 내가 띄운 프로세스와 그 명령 줄(macOS `ps`, Linux `/proc`, Windows PowerShell `Get-CimInstance`), 돌고 있는 작업의 로그 파일과 폴더(macOS `lsof`, Linux `/proc`).
- 배터리와 메모리(macOS `pmset`·`memory_pressure`·`sysctl`, Linux `/proc/meminfo`·`/sys/class/power_supply`, Windows `GlobalMemoryStatusEx`·`GetSystemPowerStatus`).
- 최근 7일: Claude Code 가 `~/.claude/projects`(`CLAUDE_CONFIG_DIR` 을 정했으면 그 아래 `projects`)에 남기는 대화 기록 파일에서 시각·토큰 수와 직접 친 프롬프트인지만 뽑아요. 대화 내용은 남기거나 보여 주지 않아요.
- Claude 사용량: Claude Code 가 알려 주는 값이에요.
- Codex 사용량: 로그인된 Codex 계정으로 내 컴퓨터의 `codex app-server` 에 물어봐요. 5분쯤에 한 번, 그리고 작업이 끝날 때(`/status-panel` 을 칠 때도)예요. 이 요청은 Codex 가 OpenAI 에 보내고, 그 기록은 Codex 가 평소처럼 남겨요.
- 그 밖에는 아무 데도 보내지 않아요.
- 설정은 Claude Code 의 플러그인 저장소에 남겨요.
- 패널이 쓰는 파일은 `~/.cache/status-panel/` 의 둘이에요. `week.json`(나만 읽을 수 있어요)에는 대화 기록 파일마다 경로, 어디까지 읽었는지, 날마다 합친 값, 같은 응답을 두 번 세지 않으려고 기억하는 최근 응답 몇 개의 ID 가 들어가요.
- `claude-usage-v2.json` 에는 세션마다 무작위 이름 하나와 Claude 사용량의 창 종류 이름(`five_hour` 같은 것)·숫자(쓴 비율·리셋 시각·본 시각·적은 횟수)만 들어가요. 세션끼리 이 파일로 나눠서, 다른 세션에서 일해도 모든 세션의 사용량 줄이 바뀌어요. `CLAUDE_CONFIG_DIR` 을 정했으면 파일 이름에 그 경로의 해시가 붙어요.
- 개발용 조정 파일 `~/.claude/status-panel-tune.json` 은 있을 때만 읽어요.

## 그림

`clawd/sprites.json` 은 Anthropic 의 마스코트 Clawd 를 Anthropic 공식 Clawd 스티커를 바탕으로 찍은 팬 도트 그림이에요. 이 저장소의 MIT 라이선스에 들어가지 않고, 캐릭터의 권리는 Anthropic 에 있어요. 내려 달라는 요청이 오면 내릴게요.

커비·마리오·포켓몬 테마는 팬이 그린 비공식 도트 그림이에요. 닌텐도·HAL 연구소·게임 프리크·크리처스·포켓몬 컴퍼니와 관계가 없고 승인받지 않았으며, 캐릭터는 이들의 것이에요. Clawd 그림처럼 이 저장소의 MIT 라이선스에 들어가지 않고, 내려 달라는 요청이 오면 내릴게요.

## 개발

```
claude plugin validate .
claude plugin test .
python3 -I -B tests/week_test.py
python3 -I -B tests/platform_test.py
```

파이썬 시험은 GitHub Actions 에서 Ubuntu·macOS·Windows 로도 돌아요.

개발할 때 조정용으로 `~/.claude/status-panel-tune.json` 이 있으면 5초마다 읽어요. `{ "debug": true }` 를 넣으면 패널 맨 위에 줄 수가 보여요.

## 라이선스

코드는 MIT 라이선스예요([LICENSE](LICENSE)). 그림(Clawd 와 테마)은 MIT 밖이에요([그림](#그림)·[NOTICE](NOTICE) 참고).
