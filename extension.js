const vscode = require('vscode')
const hexToRgba = require('hex-to-rgba')
const fs = require('fs')
const debounce = require('lodash.debounce')
const Diff = require('diff-compare')

let decorRanges = []
let docContent = []
let visibleTextEditors = []
let config = {}
let gutterConfig = {}
let overviewConfig = {}
let commentController

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    await readConfig(context)
    await checkForGitPresense(context)

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('show-unsaved-changes')) {
            await readConfig(context)
            await checkForGitPresense(context)
        }
    })

    // on start
    for (const editor of vscode.window.visibleTextEditors) {
        await initDecorator(editor, context)
    }

    // on new document
    vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        for (const editor of editors) {
            await reApplyDecors(editor, context)
        }
    })

    // on close
    vscode.workspace.onDidCloseTextDocument(async (doc) => {
        if (doc && doc.isClosed && visibleTextEditors.includes(doc.fileName)) {
            await resetDecors(doc.fileName)
            removeDocOriginalContentFor(doc.fileName)
        }
    })

    // on typing
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(
            debounce(async (e) => {
                if (e) {
                    let editor = vscode.window.activeTextEditor

                    if (editor) {
                        let { document } = editor

                        if (editor && document == e.document) {
                            let { isDirty, version, isUntitled } = document

                            // full undo
                            if (
                                !isDirty && version > 1 && !isUntitled &&
                                (contentNotChanged(document) || config.clearOnSave)
                            ) {
                                await resetDecors()
                                await initDecorator(editor, context)
                            } else {
                                await updateGutter(editor)
                            }
                        }
                    }
                }
            }, 250)
        )
    )
}

/* Decors ------------------------------------------------------------------- */
// init
function initDecorator({ document }, context) {
    visibleTextEditors.push(document.fileName)

    return new Promise((resolve) => {
        let { fileName } = document
        let obj = {
            name: fileName,
            addKey: createDecorator(context, 'add'),
            delKey: createDecorator(context, 'del'),
            ranges: {
                add: [],
                del: []
            },
            commentThreads: []
        }

        docContent.push({
            name: fileName,
            content: document.getText()
        })

        decorRanges.push(obj)

        resolve(obj)
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

function updateGutter(editor) {
    return new Promise((resolve, reject) => {
        try {
            let { document } = editor
            let data = getDecorRangesByName()
            let threads = data.commentThreads.forEach((one) => one.dispose()) || []
            let add = []
            let del = []

            let diff = Diff.build({
                base: data.original,
                compare: document.getText()
            })

            for (let i = 0; i < diff.compare.length; i++) {
                const item = diff.compare[i]
                let base = diff.base[i]
                let { type, value } = item

                // insert, replace, delete
                if (type && type != 'equal') {
                    let range = new vscode.Range(i, 0, i, 0)
                    let isDelete = type == 'delete'

                    // comments
                    if (
                        commentController &&
                        (isDelete || (type == 'replace' && base.value && !value))
                    ) {
                        let { languageId, uri, fileName } = document
                        let name = fileName.substr(fileName.lastIndexOf('/') + 1)
                        let msg = base.value || '...'
                        let comment = {
                            "author": { name: 'delete' },
                            "body": new vscode.MarkdownString().appendCodeblock(msg, languageId),
                            "mode": 1
                        }

                        let thread = commentController.createCommentThread(uri, range, [comment])
                        thread.label = `Show Unsaved Changes: ${name} #${i + 1}`

                        threads.push(thread)
                    }

                    // ranges
                    isDelete ? del.push(range) : add.push(range)
                }
            }

            updateCurrentDecorRanges({
                ranges: {
                    add: add,
                    del: del
                },
                commentThreads: threads
            })

            editor.setDecorations(data.addKey, add)
            editor.setDecorations(data.delKey, del)

            resolve()
        } catch ({ message }) {
            reject()
        }
    })
}

async function reApplyDecors(editor, context) {
    let data = await getDecorRangesByName(editor.document.fileName)

    if (data) {
        return new Promise((resolve) => {
            editor.setDecorations(data.addKey, data.ranges.add)
            editor.setDecorations(data.delKey, data.ranges.del)

            resolve()
        })
    } else {
        await initDecorator(editor, context)
    }
}

function resetDecors(name = getCurrentFileName()) {
    return new Promise((resolve) => {
        for (let i = 0; i < decorRanges.length; i++) {
            let item = decorRanges[i]

            if (item.name == name) {
                item.addKey.dispose()
                item.delKey.dispose()
                item.commentThreads.forEach((one) => one.dispose())
                decorRanges.splice(i, 1)
                break
            }
        }

        visibleTextEditors.splice(visibleTextEditors.indexOf(name), 1)

        resolve()
    })
}

/* Ranges ------------------------------------------------------------------- */
function getDecorRangesByName(name = getCurrentFileName()) {
    let found = decorRanges.find((e) => e.name == name)

    if (found) {
        return Object.assign(found, { original: getDocOriginalContentFor(name).content })
    }

    return false
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

/* Config ------------------------------------------------------------------- */
async function readConfig(context) {
    config = await vscode.workspace.getConfiguration('show-unsaved-changes')
    overviewConfig = config.styles.overview
    gutterConfig = config.styles.gutter

    await changeIconColor(context, 'add', gutterConfig.add)
    await changeIconColor(context, 'del', gutterConfig.del)
}

function changeIconColor(context, type, color) {
    return new Promise((resolve) => {
        return fs.writeFile(
            context.asAbsolutePath(`./img/${type}.svg`),
            `<svg width="10" height="40" viewPort="0 0 10 40" xmlns="http://www.w3.org/2000/svg"><polygon points="5,0 10,0 10,40 5,40" fill="${color}"/></svg>`,
            () => {
                resolve()
            }
        )
    })
}

/* Content ------------------------------------------------------------------ */
function getDocOriginalContentFor(name) {
    return docContent.find((item) => item.name == name)
}

function removeDocOriginalContentFor(name) {
    let i = docContent.findIndex((e) => e.name == name)

    return docContent.splice(i, 1)
}

function contentNotChanged(document) {
    let data = getDocOriginalContentFor(document.fileName)

    return data && data.content == document.getText()
}

/* Util --------------------------------------------------------------------- */
function getCurrentFileName() {
    try {
        return vscode.window.activeTextEditor.document.fileName
    } catch (error) {
    }
}

async function checkForGitPresense(context) {
    let check = false

    if (config.scmDisable) {
        let files = await vscode.workspace.findFiles('.gitignore', null, 1)

        check = !!files.length
    }

    if (check) {
        if (commentController) {
            commentController.dispose()
        }
    } else {
        commentController = vscode.comments.createCommentController('show-unsaved-changes', 'Show Unsaved Changes')
        context.subscriptions.push(commentController)
    }
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
