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

    // on close
    vscode.workspace.onDidCloseTextDocument(
        debounce(async function (doc) {
            if (doc) {
                await resetDecors(doc.fileName)
            }
        }, 100)
    )

    // on new document
    vscode.window.onDidChangeVisibleTextEditors(
        debounce(async function (editors) {
            for (const editor of editors) {
                await reApplyDecors(editor)
            }
        }, 200)
    )

    // on typing
    vscode.workspace.onDidChangeTextDocument(async (e) => {
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
                        await updateGutter(content, editor)
                    }
                }
            }
        }
    })
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
            }
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
function updateGutter(selections, editor) {
    return new Promise((resolve) => {
        let data = getDecorRangesByName()
        let add = data.ranges.add
        let del = data.ranges.del

        for (const change of selections) {
            let { range, text } = change

            if (!text) {
                add.splice(add.indexOf(range), 1)
            } else {
                add.push(range)
            }
        }

        updateCurrentDecorRanges({
            ranges: {
                add: add,
                del: del
            }
        })

        editor.setDecorations(data.addKey, add)
        editor.setDecorations(data.delKey, del)

        resolve()
    })
}

async function reApplyDecors(editor) {
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
    return list.find((item) => {
        return item.start.line === range.start.line &&
            item.end.line === range.end.line
    })
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

exports.activate = activate

function deactivate() { }
module.exports = {
    activate,
    deactivate
}
