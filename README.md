# Show Unsaved Changes

show unsaved changes for document in gutter (kinda like git)

![demo](https://user-images.githubusercontent.com/7388088/72254779-b5281880-360d-11ea-92f7-1e8508f356aa.png)

> ## v1.0+

we now use vscode git diff which give us much more flexibility in showing the changes & also allows you to always get the same experiance regardless of the opened file.

- `file` docs

    | file case    | diff provider |
    | ------------ | ------------- |
    | tracked      | native        |
    | new + staged | custom        |
    | untracked    | custom        |
    | gitignored   | custom        |
    | non-repo     | custom        |

- `vscode-userdata` docs (vscode settings/keybings) **"custom"**.
- `untitled` docs **"use the custom gutter & overview ruler"**.
- commands to jump between changes (`Go To Prev/Next Change`)
- clear the current doc indicators (`Clear Diff Indicators`)
    - incase you want to keep `showUnsavedChanges.clearOnSave: off` but the file changes became too noisy.

## Features

- show `added/changed/deleted` lines indicators in gutter & overview ruler
- `deleted` lines can be accessed through the "gutter comment icon"
- indicators persist after `save` so you can track what happened to the file (no git needed); clear them with `Clear Doc Indicators` or set `clearOnSave: true`
- remove indicators on file `close`

## Notes

- `git` must be installed globally because we use `git diff` to get the changes
