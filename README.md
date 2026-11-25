<div align="center">

# patteo

**[Paseo](https://paseo.sh) in your terminal.** Run and steer your coding agents, read what they changed, follow their pull requests and answer their questions, all from the keyboard.

[![Release](https://img.shields.io/github/v/release/achintya-7/patteo?color=89b4fa&label=release)](https://github.com/achintya-7/patteo/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/achintya-7/patteo/ci.yml?branch=main&label=CI)](https://github.com/achintya-7/patteo/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/achintya-7/patteo?color=a6e3a1)](LICENSE)
![Platforms](https://img.shields.io/badge/macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-cba6f7)
[![Stars](https://img.shields.io/github/stars/achintya-7/patteo?style=social)](https://github.com/achintya-7/patteo/stargazers)

<img src="docs/demo.gif" alt="patteo: a conversation with a coding agent, the changes panel, a syntax-coloured diff, a pull request, and an agent asking a question — all from the keyboard" width="1000">

<sub>The demo is the real interface, recorded from the real code with demo data.</sub>

</div>

## Why patteo

- **Everything on the keyboard.** A sidebar of projects and workspaces, a tab per agent, and a command palette (`Ctrl+K`) for the rest. Every action has a key, and none of them fire while you're typing.
- **See what your agents did.** A Files / Changes / PR panel shows the tree, the diff against your base branch with syntax colours, and the pull request with its checks, review and merge state.
- **Never miss a question.** When an agent stops to ask you something, or for permission, a line above the composer says so, and `p` opens a form to answer it.
- **One self-contained binary.** A 30-45 MB download with nothing else to install: no Node, no Python. macOS, Linux and Windows.
- **Many machines.** Connect to the daemon on your laptop, your desktop and your dev box at once, and switch with `H`.
- **Yours to restyle.** 15 themes, a transparent background that keeps your terminal's look, and your own themes and key bindings in JSON.
- **Private.** It talks only to the Paseo daemons you point it at. No telemetry, no accounts.

## Install

```bash
# macOS and Linux
curl -fsSL https://raw.githubusercontent.com/achintya-7/patteo/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/achintya-7/patteo/main/install.ps1 | iex
```

```bash
# Homebrew
brew tap achintya-7/patteo https://github.com/achintya-7/patteo && brew install patteo
```

Then start it with `patteo`. It finds the Paseo daemon on your machine by itself, so open Paseo Desktop (or run `paseo daemon`) first.

<details>
<summary><b>Docker, a specific version, uninstalling, building from source</b></summary>

<br>

**Docker**

```bash
# Linux: share the host network so the container reaches the daemon on 127.0.0.1:6767
docker run -it --rm --network host -v patteo-config:/home/patteo/.config/patteo ghcr.io/achintya-7/patteo

# Docker Desktop (macOS / Windows)
docker run -it --rm -v patteo-config:/home/patteo/.config/patteo ghcr.io/achintya-7/patteo --host host.docker.internal:6767
```

The Paseo daemon refuses host names it doesn't know (`Invalid Host header`), so for the Docker Desktop form start the daemon with `PASEO_ALLOWED_HOSTS=host.docker.internal`. `docker build -t patteo .` builds the image yourself, and `docker build --target test .` runs the typecheck and tests on Linux.

**The install scripts** download the release for your platform, check it against `checksums.txt`, and put `patteo` in `~/.local/bin` (macOS and Linux) or `%LOCALAPPDATA%\patteo\bin` (Windows, added to your PATH). Options: `--version 0.1.0`, `--dir <path>`, `--uninstall` (`-Version`, `-InstallDir`, `-Uninstall` in PowerShell). Run the same command again to upgrade. The Linux binary needs glibc; on Alpine use the Docker image.

**From source** (Bun 1.4+):

```bash
git clone https://github.com/achintya-7/patteo && cd patteo
bun install
bun run dev                    # connect to the local daemon (~/.paseo)
bun run dev --host box:6767    # also connect to another daemon
bun run dev --theme gruvbox-dark
bun run build                  # single binary: dist/patteo
```

</details>

## First five minutes

| Press | To |
|---|---|
| `Ctrl+K` | open the command palette: every action, searchable |
| `?` | see all shortcuts |
| `n` | start a new agent (provider, model, mode, first message) |
| `i` | write to the agent (`Enter` sends, `Alt+Enter` adds a line, `Esc` leaves the box) |
| `C` | open the Files / Changes / PR panel |
| `p` | answer an agent's question or review a permission request |

Arrow keys or `j`/`k` move around. `Tab` switches panes. `Esc` in the conversation stops a running turn.

## What it looks like

### Read what the agent changed

`C` opens the panel. **Changes** lists what the pull request contains (your branch against its base), and `Enter` opens a file's diff in the main pane: added and removed rows are tinted, code is coloured by the daemon's syntax tokens, and `[` `]` step between files. `m` cycles what is compared: the PR's changes, uncommitted work, or both.

<img src="docs/screenshots/changes.svg" alt="A syntax-coloured diff next to the list of changed files" width="900">

### Follow the pull request

The **PR** tab shows the number, state, title, every check (failures first), the review decision and the merge status. `o` opens it in your browser, and `Enter` creates a pull request when there isn't one.

<img src="docs/screenshots/pr.svg" alt="The PR tab with checks, review and merge status, in a light theme" width="900">

### Answer the agent when it asks

When an agent asks you a question, a line above the composer and a flag in the status bar tell you, and `p` opens the form. Pick an option (`1`-`9`), tick several, or type your own answer. Several questions in one go work too.

<img src="docs/screenshots/question.svg" alt="A multiple-choice question from an agent" width="900">

### Browse the project

The **Files** tab is the workspace's tree, listed by the daemon (so it works for remote hosts too). Changed files and the folders holding them are marked, and `.` toggles dotfiles.

<img src="docs/screenshots/files.svg" alt="The Files tab with git markers on changed files" width="900">

### And the rest

- **Slash commands** in the composer: `/fork` to branch the conversation into a new tab, `/stop`, `/new`, `/model`, `/mode`, `/settings`.
- **Subagents**: run `/subagents` or choose **Subagents…** from Ctrl-K. Pick a child in the current workspace to open its live conversation. Press backtick to return to the previous tab.
- **Add a folder** (`A`) as a workspace, with shell-style `Tab` completion.
- **Many hosts** (`H`): add, rename, reconnect and switch between daemons.
- **Live conversation** with markdown, code blocks, tables and mermaid diagrams, and the agent's activity folded into one quiet line (`e` expands it).
- **Permission requests**: allow or deny from a dialog, with the provider's own options.

## Themes

15 built in: Catppuccin (4), Gruvbox (2), GitHub (2), Tokyo Night, Nord, Dracula, One Dark, Rosé Pine, Solarized Dark and Kanagawa. `T` changes the theme with a live preview. The background is transparent by default, so patteo looks like your terminal; `--opaque` paints the theme's own.

<table>
<tr>
<td><img src="docs/screenshots/theme-dracula.svg" alt="Dracula"></td>
<td><img src="docs/screenshots/theme-rose-pine.svg" alt="Rosé Pine"></td>
</tr>
<tr>
<td><img src="docs/screenshots/theme-kanagawa.svg" alt="Kanagawa"></td>
<td><img src="docs/screenshots/theme-one-dark.svg" alt="One Dark"></td>
</tr>
<tr>
<td><img src="docs/screenshots/theme-gruvbox-light.svg" alt="Gruvbox Light"></td>
<td><img src="docs/screenshots/theme-solarized-dark.svg" alt="Solarized Dark"></td>
</tr>
</table>

## Keys

| Key | Action |
| --- | --- |
| `Ctrl+K` / `Ctrl+P` | Command palette |
| `?` | All shortcuts |
| `,` | Settings |
| `Tab` | Switch pane · `Ctrl+B` toggle the sidebar · **in the composer**: complete a `/` command, otherwise indent |
| `n` / `Ctrl+O` | New agent (pick a folder first when none is selected) |
| `i` / `Enter` | Write a message (from the conversation) · `Esc` back |
| `Ctrl+X` / `Esc` | Stop the running turn (`Esc` in the conversation) |
| `Shift+Tab` | Next mode · `M` change model |
| `p` | Answer questions and review permissions |
| `C` | Files / Changes / PR panel · `[` `]` or `1` `2` `3` for tabs · `P` jumps to the PR tab |
| `A` | Add folder · `Ctrl+G` creates it if missing |
| `H` | Hosts: `a` add · `e` rename · `r` reconnect · `d` remove |
| `T` | Change theme |
| `e` / `r` | Expand activity / show thoughts |
| `q` | Quit (never while typing) |
| Mouse drag | Select text; it goes to your clipboard (native clipboard and OSC 52, so it works over SSH too) |
| `⌘V` / `Ctrl+V` | Paste into the composer (terminals that paste by themselves work as always) |

Every key can be remapped, see below.

## Configuration

Everything lives in `~/.config/patteo/`:

- `config.json`: settings, also editable in the app with `,`. Remap keys with `"keymap": { "palette.open": ["ctrl+space"] }`; the command ids are listed under Settings → Keyboard.
- `themes/<name>.json`: your own themes, any subset of tokens over a base theme: `{ "extends": "nord", "accent": "#ff79c6" }`.
- `hosts.json` and `state.json`: your hosts, and UI state (tabs, selection).

Debug logs: `PATTEO_DEBUG=1 patteo`, then read `~/.config/patteo/patteo.log`.

## FAQ

**Do I need Paseo?** Yes. patteo is a client: the [Paseo](https://paseo.sh) daemon runs the agents, and patteo drives it through the public `@getpaseo/client` SDK. Paseo Desktop installs the daemon.

**Does it work with a daemon on another machine?** Yes: `patteo --host box:6767`, or add it with `H`. SSH tunnels and pairing links are not supported yet; use a `host:port` or `ws://` address.

**Which terminals work?** Any modern terminal with true colour. patteo is developed on macOS; the Linux and Windows binaries are smoke-tested in CI on their own systems but get less everyday use, so please open an issue if something looks off. A terminal sends the same key for `Shift+Enter` and `Enter`, so a new line in the composer is `Alt+Enter` (on macOS terminals this needs "Option as Meta/Esc+") or `Ctrl+J`, which works everywhere.

**Is the macOS binary signed?** Not yet. Installing with `curl` or Homebrew is not affected by Gatekeeper; a binary downloaded through a browser may be.

**Where does my data go?** Nowhere but the daemons you connect to. The only other network traffic is the install script, which downloads from GitHub.

## Contributing

Issues and pull requests are welcome.

```bash
bun test                    # unit and render tests
bun run typecheck
bun run check:stress        # drives the real UI: resizes, dialogs, composer, all themes
bun run screenshots         # regenerates docs/screenshots from demo data
brew install vhs && bun run demo   # re-records docs/demo.gif from the same data
bun scripts/frames.tsx 120 30   # print screen captures (KEYS="j,return,wait" to drive it)
```

Releases are automatic. Every push to `main` is considered: changes to the program release (`feat:` raises the minor version, `feat!:` or `BREAKING CHANGE` the major, anything else the patch), while docs, tests and CI don't. Add `[skip release]` to a commit message to keep it out. A release builds every platform, runs each binary on its own OS, then publishes the GitHub release, the Homebrew formula and the Docker image. To force or preview one, use Actions → Release → Run workflow.

`patches/` holds one Bun patch for `@opentui/core` 0.9.7, whose markdown renderer crashed on a streamed list (`updateList` read an item that hadn't been shown yet). Drop it once upstream fixes the bug.

## License

[Apache-2.0](LICENSE). patteo is an independent client built on Paseo's public SDK; some modules follow the structure of the Paseo app (Apache-2.0, © Mohamed Boudra), see [NOTICE](NOTICE). Built with [Bun](https://bun.sh), [OpenTUI](https://opentui.com) and React.
