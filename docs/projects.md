---
description: Texpile treats the folder as the project: a file explorer with drag and drop, tabs, multi-file document support, find in files, and a table of contents.
blurb: The folder is the project: explorer, tabs, multi-file documents, search, and references.
icon: files
order: 6
section: Editor
---

# Projects and files

A paper is usually more than one file. Texpile treats the folder as the project, with no separate project file to keep in sync.

| Where to find it | Path                     | Note                                                       |
| ---------------- | ------------------------ | ---------------------------------------------------------- |
| Panel            | The sidebar              | The file explorer, with Contents below it.                 |
| Shortcut         | Ctrl+Shift+F             | Find in files.                                             |
| Shortcut         | Ctrl+K                   | The command palette: open a file or run an action.         |
| Menu             | File › New Window        | Also File › Open folder in new window.                     |
| In the editor    | Open an empty folder     | The templates. Pick one to start the project from it.      |
| Menu             | File › Save as template… | Also in the command palette. Saves the folder as your own. |

![The file explorer showing a multi-file paper](../landing/src/lib/assets/showcase/thumbs/thumb-tree.png#narrow 'The file explorer showing a multi-file paper')

## File explorer

Every file in the folder, with multi-select using Ctrl and Shift and drag and drop within the tree.

- Drag files and folders in from your system's file manager to import them.
- Ctrl+V pastes: a screenshot on your clipboard becomes a new image file, and copied files are copied in.
- Drag and drop within the tree to move files between folders.

## Tabs

Open files appear as tabs above the editor, and your open tabs come back when you reopen the folder. Right-click a tab to close the other tabs, the ones to its right, or the saved ones, to copy the path, or to show the file in its folder or in the file tree.

## Multi-file documents

Files pulled in with `\input` are read with the main file's macros and packages, so a chapter opens on its own without losing them.

## Table of contents

A contents panel lists your headings, figures, tables, and beamer frames. Click an entry to jump to it.

## Word count

Words and characters for the whole document, or for the current selection.

## Templates

An empty folder opens on a choice of templates, on a LaTeX tab and a Typst tab. LaTeX has a basic article, an MLA essay, an APA paper, and the tutorial. Typst has a paper, a report or thesis with a file per chapter, a letter, slides, and an empty document. The Typst ones use nothing outside Typst itself, so they compile without a network connection. Picking one writes its files into the folder, keeps any file already there, and sets its main file.

### Your own templates

File › Save as template… copies the open folder into a template of your own, with a name and an optional description. Compile output, compile scratch files, and hidden folders such as .git are left out, and the new project opens on the current main file. Saving under a name you already use asks before replacing that template, and a folder over 20 MB asks before copying.

Your templates are listed under Your templates, on the tab of their typesetter. Right-click one, or use its ⋯ button, to rename or delete it. They are kept in Texpile's own data folder, or beside the app in the portable build, and never inside a project.

### Typst Universe

On the Typst tab, Browse Typst templates… lists the templates published on Typst Universe, with their preview pictures, and creates the project from the one you pick through tinymist. This goes online: the list is downloaded when you open it, the template you pick is downloaded, and compiling it may download the packages it uses. Nothing is fetched before you open the list.

## Getting around

The command palette opens files and runs editor actions without leaving the keyboard. You can also work in several windows at once, and relaunching reopens each on its last open file.

![The command palette open on Ctrl+K, listing compile, view, and editor actions](../landing/src/lib/assets/showcase/app/command-palette.png#narrow)

[All keyboard shortcuts](shortcuts.md)
