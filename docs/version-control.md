---
description: Texpile keeps versions of your project with git: save a version with a message, see what changed since the last one in a visual diff, restore an older version from the history, and publish and sync the project with GitHub or any other remote.
blurb: Save versions of your project, see what changed, restore an older one, and publish to GitHub.
icon: git-branch
order: 8
section: Editor
---

# Version control

Texpile keeps versions of your project with git, from the Source Control panel. Changes since the last version are listed by file, you tick the ones to include, write what changed, and Save version. History lists every saved version, and any of them can be restored. If the folder is not a repository yet, the panel offers to initialise one, and Publish sends it to GitHub or any other remote.

| Where to find it | Path                    | Note                                     |
| ---------------- | ----------------------- | ---------------------------------------- |
| Panel            | Source Control          | The branch icon in the sidebar header.   |
| In the panel     | Click a changed file    | Opens the diff against the last version. |
| Palette          | Switch to the diff view | Ctrl+K, then type the name.              |

![The Source Control panel: three changed files, the message box, Save version, and the history](../landing/src/lib/assets/showcase/app/source-control-panel.png 'The Source Control panel: three changed files, the message box, Save version, and the history')

## Visual diff

A changed file opens in a diff against the last version. In the visual editor the changes are marked in the formatted text, word by word. In the source editor they are marked line by line.

![The visual editor showing a heading and a sentence changed since the last version](../landing/src/lib/assets/showcase/app/diff-view.png 'The visual editor showing a heading and a sentence changed since the last version')

## Publish and sync

Once the project has a version, Publish appears beside the branch name. It sends the project somewhere else: a new GitHub repository, private or public, created for it; a remote the repository already has; or any other repository by its address. With exactly one remote already set up, Publish goes straight there.

After that the button becomes Sync. Sync fetches, takes in versions saved elsewhere, and sends yours, and it shows how many versions go each way. When both sides changed the same lines of a file, Sync undoes the attempt, names the file, and offers to combine them now; nothing changes unless you say yes. When a change that is not saved as a version would be overwritten, Sync stops before it starts and asks you to save a version first.

## Combining two versions

Combine now brings in the other side's versions and leaves each place where both sides changed the same lines marked in its file. The file opens in the source editor at the first one, whichever editor you were using: your version is tinted one colour and theirs another, and above each place are Keep mine, Keep theirs and Keep both. Each choice is one step in the undo history. You can also edit the lines yourself; a place counts as chosen once its `<<<<<<<`, `=======` and `>>>>>>>` lines are gone.

Source Control lists the files under Both changed, and marks each one Ready once every place in it is chosen. Finish combining saves the result as one version, which Sync then sends. Cancel combining puts every file back as it was before you started, and the choices go with it.

| While combining  | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| Click a file     | Opens it in the source editor at its first marked place.            |
| Finish combining | Saves the combined files as one version. Waits until each is Ready. |
| Cancel combining | Puts everything back as it was before combining started.            |

A merge started in the terminal gets the same Finish and Cancel. A rebase or cherry-pick left unfinished there is shown in the panel, and is finished or cancelled in the terminal.

## Signing in

Texpile signs in with whatever git already uses: Git Credential Manager, the macOS keychain, `gh auth setup-git`, or an SSH key. When none of those has an answer, git's question appears in the window instead of failing: a username and password, an SSH key's passphrase, or whether to trust a server it has not seen before. For GitHub, use a personal access token with the repo scope as the password. A credential manager keeps it after it works, so it is asked for once.

The first time you save a version on a computer where git does not know your name and email, Texpile asks for them and saves them for all your projects.

> [!NOTE]
> This covers the everyday loop, from the first version to GitHub. For branches and history rewriting, use the built-in terminal. It needs git installed.

[Installing git](installation/git.md)
