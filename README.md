### Features

- show line changes in the gutter
- remove the gutter indicator on undo
- remove all the gutter indicators on full-undo

## Not working

- add line above
- new line could be added manually but undo wont catch it as expected

### Notes

- changes shows up for any character other than the new line character `\n`
- indicators are removed on file `save/close`
