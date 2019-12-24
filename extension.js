const vscode = require('vscode')
const hexToRgba = require('hex-to-rgba')
const { EOL } = require('os')
const fs = require('fs')
const debounce = require('lodash.debounce')

let decorRanges = []
let decorListeners = []

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
    vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e) {
            let editor = vscode.window.activeTextEditor
            let doc = e.document

            if (editor.document == doc) {
                // init
                if (!getDecorRangesByName()) {
                    await initDecorator(context)
                }

                // full undo
                if (!doc.isDirty && doc.version > 0) {
                    await resetDecors()
                } else {
                    let content = e.contentChanges

                    if (content.length) {
                        await listenToChanges(context, content, editor)
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

        decorListeners.push({
            name: fileName,
            lines: []
        })

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
 *
 * working :
 * =========
 * undo
 * full-undo
 * multi cursor on same line
 */
function updateGutter(context, before, editor) {
    return new Promise((resolve) => {
        let after = invertSelections(editor.selections)
        let data = getDecorRangesByName()
        let add = [...data.ranges.add]
        let del = [...data.ranges.del]

        for (const item of before) {
            let text = item.text
            let line = item.range.end.line
            let range = new vscode.Range(
                line,
                0,
                line,
                0
            )

            if (!text && !text.includes(EOL) && haveRange(add, item.range)) { // for undo
                add.splice(add.indexOf(range), 1)
            } else { // add new
                add.push(range)
            }
        }

        let addList = getUniq(add)
        let delList = getUniq(del)
        let lines = addList.map((item) => {
            return item.start.line
        })

        updateCurrentDecorListener(lines)
        updateCurrentDecorRanges({
            add: addList,
            del: delList
        })

        editor.setDecorations(data.addKey, addList)
        editor.setDecorations(data.delKey, delList)

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
        if (decorListeners.length) {
            for (let i = 0; i < decorListeners.length; i++) {
                if (decorListeners[i].name == name) {
                    decorListeners.splice(i, 1)
                    break
                }
            }

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
        }
    })
}

function updateCurrentDecorRanges(val, name = getCurrentFileName()) {
    for (let i = 0; i < decorRanges.length; i++) {
        let item = decorRanges[i]

        if (item.name == name) {
            item.ranges = val
            break
        }
    }
}

function haveRange(list, range) {
    return list.find((item) => {
        return item.start.line === range.start.line
    })
}

function invertSelections(arr) {
    return arr.sort((a, b) => { // make sure its sorted correctly
        if (a.start.line > b.start.line) return 1

        if (b.start.line > a.start.line) return -1

        return 0
    }).reverse()
}

// listeners
async function listenToChanges(context, changes, editor) {
    let item = getListenerByKey()

    for (const change of changes) {
        if (item && !item.lines.includes(change.range.end.line)) {
            await updateGutter(context, [change], editor)
        }
    }
}

function getListenerByKey(name = getCurrentFileName()) {
    return decorListeners.find((e) => e.name == name)
}

function updateCurrentDecorListener(val, name = getCurrentFileName()) {
    for (let i = 0; i < decorListeners.length; i++) {
        if (decorListeners[i].name == name) {
            decorListeners[i].lines = val
            break
        }
    }
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

exports.activate = activate

function deactivate() { }
module.exports = {
    activate,
    deactivate
}
