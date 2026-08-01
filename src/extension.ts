import pDebounce from 'p-debounce'
import * as vscode from 'vscode'
import * as decorations from './libs/decorations'
import * as navigation from './libs/navigation'
import * as quickDiff from './libs/quickDiff'
import * as state from './libs/state'
import * as utils from './libs/utils'

export async function activate(context: vscode.ExtensionContext) {
    utils.readConfig()
    utils.checkForOutputOption(context)
    quickDiff.register(context)

    vscode.workspace.onDidChangeConfiguration(async(e) => {
        if (e.affectsConfiguration(utils.PKG_NAME)) {
            utils.readConfig()
            utils.checkForOutputOption(context)

            await decorations.visibleEditors(true)
        }
    })

    // on start
    await decorations.visibleEditors()

    context.subscriptions.push(
        // commands
        vscode.commands.registerCommand('showUnsavedChanges.goToPrevChange', () => navigation.getNearestChangedLineNumber(-1)),
        vscode.commands.registerCommand('showUnsavedChanges.goToNextChange', () => navigation.getNearestChangedLineNumber(1)),
        vscode.commands.registerCommand('showUnsavedChanges.clearDocIndicators', async() => {
            const {document} = vscode.window.activeTextEditor ?? {}

            if (document && state.hasContentFor(document.fileName)) {
                await decorations.resetAll(document.fileName)
                await decorations.initDecorator(document)
            }
        }),

        // on close
        vscode.workspace.onDidCloseTextDocument(async(document: vscode.TextDocument) => {
            const {fileName, isClosed} = document

            if (document && isClosed && state.hasContentFor(fileName)) {
                await decorations.resetAll(fileName)
            }
        }),

        // on save
        vscode.workspace.onDidSaveTextDocument(async(document: vscode.TextDocument) => {
            const {fileName} = document

            if (!state.hasContentFor(fileName)) {
                await decorations.initDecorator(document)

                return
            }

            if (utils.config.clearOnSave) {
                await decorations.resetAll(fileName)
                await decorations.initDecorator(document)
            }
        }),

        // on file change
        vscode.window.onDidChangeActiveTextEditor(async(editor: vscode.TextEditor | undefined) => {
            if (editor) {
                const {document} = editor

                if (utils.config.schemeTypes.includes(document.uri.scheme) && !decorations.isIgnored(document)) {
                    await decorations.reApplyDecors(editor)
                    await navigation.setContext(!state.contentNotChanged(document))
                }
            }
        }),

        // on typing
        vscode.workspace.onDidChangeTextDocument(
            pDebounce(decorations.onTextDocumentChange, utils.config.debounceTime),
        ),
    )
}

export function deactivate() { }
