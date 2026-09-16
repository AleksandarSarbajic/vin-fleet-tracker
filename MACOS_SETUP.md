# Mac setup — do this once before phase 0

Everything here runs in Terminal (Cmd+Space, type "Terminal", Enter).

## 1. Xcode Command Line Tools

Gives you `git` and the compilers some npm packages need.

```bash
xcode-select --install
```

If it says the tools are already installed, you're fine. Verify:

```bash
git --version
```

## 2. Homebrew

Skip if `brew --version` already works.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

On Apple Silicon the installer prints two `echo` commands at the end to add
Homebrew to your PATH. Run them, then close and reopen Terminal.

## 3. Node.js 22+

```bash
brew install node
node --version
```

Must print v22 or higher. If you already have an older Node and don't want to
disturb it, use `nvm` instead of Homebrew.

## 4. Claude Code

Requires a Pro, Max, Team, Enterprise or Console account — the free claude.ai
plan does not include Claude Code. macOS 13.0 or newer.

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Close and reopen Terminal, then:

```bash
claude --version
claude doctor
```

`claude --version` should print something like `2.1.211 (Claude Code)`.
`claude doctor` checks the install, your settings and auth without starting a
session — run it first any time something looks wrong.

The native install auto-updates in the background. Homebrew (`brew install
--cask claude-code`) also works but does not auto-update, so prefer the
command above. If `claude` isn't found after reopening Terminal, check that
`~/.local/bin` is on your PATH.

## 5. Visual Studio Code

Install VS Code from code.visualstudio.com, or:

```bash
brew install --cask visual-studio-code
```

Open VS Code, press Cmd+Shift+P, type `shell command`, and pick **Install
'code' command in PATH**. That lets you open the project with `code .`.

### The Claude Code extension

Press Cmd+Shift+X, search **Claude Code**, install the one by Anthropic.
Needs VS Code 1.98.0 or newer. Sign in with the same paid account — no API
key.

The extension is the recommended way to use Claude Code in VS Code. You get
plan review before accepting, inline side-by-side diffs, @-mentions tied to
your text selection, conversation history, and multiple conversations in
tabs. Click the Spark icon in the sidebar to open the panel; drag it wider
than you think you need or the diffs are unreadable.

Every slash command in `PHASE_PROMPTS.md` works the same in the panel as in
the terminal. Use whichever you prefer — the panel for the diff review, or
`claude` in the integrated terminal (Ctrl+`) if you'd rather stay in one
text surface.

One gotcha: the extension bundles its own copy of the CLI for the panel, so
the version there can differ from the `claude` you installed in step 4. If
the two ever behave differently, that's why. Update the extension via
Cmd+Shift+P → **Claude Code: Update**.

### Project extensions

The project ships a `.vscode/extensions.json`. When you open the folder,
VS Code offers to install the recommended set — accept it. It's Tailwind
IntelliSense, ESLint, Prettier, Vitest, Playwright, dotenv syntax and
Error Lens.

`.vscode/settings.json` is also included: format on save with Prettier,
ESLint autofix, the workspace TypeScript version, and Tailwind class
detection inside `clsx`/`cva` calls. Both files are committed so the
settings travel with the repo.

## 6. Put the project in place

Download the project files, then:

```bash
mkdir -p ~/Projects/vin-fleet-tracker/design
mkdir -p ~/Projects/vin-fleet-tracker/.vscode
cd ~/Projects/vin-fleet-tracker

mv ~/Downloads/CLAUDE.md .
mv ~/Downloads/PROJECT_BRIEF.md .
mv ~/Downloads/PHASE_PROMPTS.md .
mv ~/Downloads/MACOS_SETUP.md .
mv ~/Downloads/.gitignore .
mv ~/Downloads/Fleet_Tracker_dc.html design/
mv ~/Downloads/extensions.json .vscode/
mv ~/Downloads/settings.json .vscode/
```

If Safari saved the gitignore as `gitignore.txt` or a file came down with a
`(1)` in the name, fix those names before moving. Check what actually landed:

```bash
ls -la ~/Downloads | grep -i "fleet\|claude\|project\|gitignore\|settings\|extensions"
```

Then verify the layout:

```bash
cd ~/Projects/vin-fleet-tracker
find . -type f | sort
```

You should see eight files: `.gitignore`, `.vscode/extensions.json`,
`.vscode/settings.json`, `CLAUDE.md`, `MACOS_SETUP.md`, `PHASE_PROMPTS.md`,
`PROJECT_BRIEF.md`, and `design/Fleet_Tracker_dc.html`.

## 7. Git

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"

cd ~/Projects/vin-fleet-tracker
git init
git add .
git commit -m "chore: brief, design, rules"
```

## 8. Start

```bash
cd ~/Projects/vin-fleet-tracker
code .
```

Accept the recommended extensions prompt. Then open the Claude Code panel
(Spark icon) and sign in, or press Ctrl+` and run `claude` in the integrated
terminal — either surface works.

Open `PHASE_PROMPTS.md` and paste the phase 0 prompt.

Do **not** run `/init`.

---

## Mac-specific notes

**Keyboard.** `Esc` interrupts Claude mid-answer. `Esc Esc` rewinds. Shift+Tab
cycles permission modes, but use `/plan` instead — it goes straight there.
In VS Code, Ctrl+` toggles the terminal and Cmd+Shift+X opens Extensions.
In the app you're building, Cmd+Enter saves the edit modal.

**The design file will make VS Code sluggish if you open it.** 270 KB of
inline-styled HTML on one screen. You don't need to open it — phase 0 turns
it into `docs/design-spec.md` and you read that instead.

**Two Claude panels is a mistake.** Pick the extension panel or the terminal
CLI, not both at once in the same folder. Two agents editing the same files
with separate conversation state is how you get half-applied changes.

**Terminal.app is fine.** If you use iTerm2 instead and arrow keys or Option
shortcuts behave oddly, set Preferences → Profiles → Keys → Left Option key →
Esc+.

**Gatekeeper.** macOS may warn the first time something unsigned runs. The
Claude Code binary is signed by Anthropic and notarized by Apple, so you
shouldn't see it for `claude` itself.

**Don't use `sudo` with npm.** If you hit permission errors installing
packages, the fix is fixing ownership, never `sudo npm install -g`.

**Sleep.** The ingestion worker in phase 2 runs continuously. Your Mac
sleeping stops it, which is fine for local testing — phase 6 deploys it to a
host that stays awake. Don't debug "the worker stopped overnight" as a bug.
