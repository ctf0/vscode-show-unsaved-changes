const vscode = require('vscode')
const hexToRgba = require('hex-to-rgba')
const { EOL } = require('os')
const fs = require('fs')
const debounce = require('lodash.debounce')

let decorRanges = []

let config = {}
let gutterConfig = {}
let overviewConfig = {}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {

    readConfig(context)

    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('show-unsaved-changes')) {
            readConfig(context)
        }
    })

    // on new document
    vscode.window.onDidChangeVisibleTextEditors(
        debounce(async function (editors) {
            for (const editor of editors) {
                await reApplyDecors(context, editor)
            }
        }, 200)
    )

    // on typing
    vscode.workspace.onDidChangeTextDocument(
        debounce(async function (e) {
            if (e) {
                let editor = vscode.window.activeTextEditor
                let doc = e.document

                if (editor && editor.document == doc) {
                    // init
                    if (!getDecorRangesByName()) {
                        await initDecorator(context)
                    }

                    // full undo
                    // untitled 'isDirty' is different from normal files
                    if (!doc.isDirty && doc.version > 0 && !doc.isUntitled) {
                        await resetDecors()
                    } else {
                        let content = e.contentChanges

                        if (content.length) {
                            if (editor.selections.length > 1) {
                                let selections = editor.selections.map((item) => {
                                    return {
                                        range: new vscode.Range(item.start, item.end),
                                        text: content[0].text
                                    }
                                })

                                await updateGutter(context, selections, editor, false)
                            } else {
                                await updateGutter(context, content, editor)
                            }
                        }
                    }
                }
            }
        }, 50)
    )
}

// init
function initDecorator(context) {
    return new Promise((resolve) => {
        let fileName = getCurrentFileName()

        decorRanges.push({
            name: fileName,
            addKey: createDecorator(context, 'add'),
            delKey: createDecorator(context, 'del'),
            ranges: {
                add: [],
                del: []
            },
            lineIndex: []
        })

        resolve()
    })
}

function createDecorator(context, type) {
    return vscode.window.createTextEditorDecorationType({
        gutterIconPath: context.asAbsolutePath(`./img/${type}.svg`),
        gutterIconSize: gutterConfig.size,
        overviewRulerColor: hexToRgba(overviewConfig[type], overviewConfig.opacity),
        overviewRulerLane: 2,
        isWholeLine: config.wholeLine
    })
}

/**
 * no need for delete but lets keep it for now
 */
function updateGutter(context, selections, editor, addExtraLine = true) {
    let changes = sortSelections(selections)

    return new Promise((resolve) => {
        let data = getDecorRangesByName()
        let add = data.ranges.add
        let del = data.ranges.del
        let newChanges = false
        for (const change of changes) {
            let line = change.range.end.line
            let text = change.text

            if (addExtraLine && text.includes(EOL)) { // hl new line
                newChanges = true
                add.push(new vscode.Range(
                    line + 1,
                    0,
                    line + 1,
                    0
                ))
            }

            if (!data.lineIndex.includes(line)) {
                newChanges = true
                let range = new vscode.Range(
                    line,
                    0,
                    line,
                    0
                )

                if (!text && !text.includes(EOL) && haveRange(add, change.range)) { // for undo
                    add.splice(add.indexOf(range), 1)
                } else {
                    add.push(range)
                }
            }
        }

        if (newChanges) {
            let addList = getUniq(add)
            let delList = getUniq(del)

            updateCurrentDecorRanges({
                ranges: {
                    add: addList,
                    del: delList
                },
                lineIndex: [...new Set(data.lineIndex.concat(addList.map((item) => item.start.line)))]
            })

            editor.setDecorations(data.addKey, addList)
            editor.setDecorations(data.delKey, delList)
        }

        resolve()
    })
}

async function reApplyDecors(context, editor) {
    let data = await getDecorRangesByName(editor.document.fileName)

    if (data) {
        await editor.setDecorations(data.addKey, data.ranges.add)
        await editor.setDecorations(data.delKey, data.ranges.del)
    }

    return
}

// ranges
function getDecorRangesByName(name = getCurrentFileName()) {
    return decorRanges.find((e) => e.name == name)
}

function resetDecors(name = getCurrentFileName()) {
    return new Promise((resolve) => {
        for (let i = 0; i < decorRanges.length; i++) {
            let item = decorRanges[i]

            if (item.name == name) {
                item.addKey.dispose()
                item.delKey.dispose()
                decorRanges.splice(i, 1)
                break
            }
        }

        resolve()
    })
}

function updateCurrentDecorRanges(val, name = getCurrentFileName()) {
    for (let i = 0; i < decorRanges.length; i++) {
        let item = decorRanges[i]

        if (item.name == name) {
            item = Object.assign(item, val)
            break
        }
    }
}

function haveRange(list, range) {
    return list.find((item) => item.start.line === range.start.line)
}

// config
function readConfig(context) {
    config = vscode.workspace.getConfiguration('show-unsaved-changes')
    overviewConfig = config.styles.overview
    gutterConfig = config.styles.gutter

    changeIconColor(context, 'add', gutterConfig.add)
    changeIconColor(context, 'del', gutterConfig.del)
}

function changeIconColor(context, type, color) {
    return fs.writeFile(
        context.asAbsolutePath(`./img/${type}.svg`),
        `<svg width="10" height="40" viewPort="0 0 10 40" xmlns="http://www.w3.org/2000/svg"><polygon points="5,0 10,0 10,40 5,40" fill="${color}"/></svg>`,
        () => { }
    )
}

// util
function getCurrentFileName() {
    return vscode.window.activeTextEditor.document.fileName
}

function getUniq(arr) {
    return arr.reduce((acc, current) => {
        const x = haveRange(acc, current)

        if (!x) {
            return acc.concat([current])
        } else {
            return acc
        }
    }, [])
}

function sortSelections(arr) {
    return arr.sort((a, b) => { // make sure its sorted correctly
        if (a.range.start.line > b.range.start.line) return 1
        if (b.range.start.line > a.range.start.line) return -1

        return 0
    })
}

exports.activate = activate

function deactivate() { }
module.exports = {
    activate,
    deactivate
}
