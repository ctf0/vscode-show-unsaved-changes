import hexToRgba from 'hex-to-rgba';
import pDebounce from 'p-debounce';
import * as vscode from 'vscode';
import * as compare from './Compare';
import * as utils from './utils';

const decorRanges: utils.DecorRange[] = [];
const documentsContent: utils.DocumentContent[] = [];

export async function activate(context) {
    utils.readConfig();
    utils.checkForOutputOption(context);

    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(utils.PKG_NAME)) {
            utils.readConfig();
            utils.checkForOutputOption(context);

            await visibleEditors(true);
        }
    });

    // on start
    await visibleEditors();

    context.subscriptions.push(
        // commands
        vscode.commands.registerCommand('showUnsavedChanges.goToPrevChange', () => getNearestChangedLineNumber(-1)),
        vscode.commands.registerCommand('showUnsavedChanges.goToNextChange', () => getNearestChangedLineNumber(1)),

        // on close
        vscode.workspace.onDidCloseTextDocument(async (document: vscode.TextDocument) => {
            const { fileName, isClosed } = document;

            if (document && isClosed && hasContentFor(fileName)) {
                await resetAll(fileName);
            }
        }),

        // on save
        vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            const { fileName } = document;

            if (hasContentFor(fileName) && utils.config.clearOnSave) {
                await resetAll(fileName);
                await initDecorator(document);
            }
        }),

        // on file change
        vscode.window.onDidChangeActiveTextEditor(async (editor: vscode.TextEditor | undefined) => {
            if (editor) {
                const { document } = editor;

                if (utils.config.schemeTypes.includes(document.uri.scheme) && !isIgnored(document)) {
                    await reApplyDecors(editor);
                    await setContext(!contentNotChanged(document));
                }
            }
        }),

        // on typing
        vscode.workspace.onDidChangeTextDocument(
            pDebounce(async (e: vscode.TextDocumentChangeEvent) => {
                const { document } = e;
                const editor = getActiveEditor();

                if (editor && editor.document === document) {
                    // full undo
                    if (
                        document.version > 1 &&
                        contentNotChanged(document)
                    ) {
                        await resetAll(document.fileName);

                        return initDecorator(document);
                    } else {
                        return updateDecors(document);
                    }
                }
            }, utils.config.debounceTime),
        ),
    );
}

async function visibleEditors(updateDecors: boolean = false) {
    for (const editor of vscode.window.visibleTextEditors) {
        try {
            await reApplyDecors(editor, updateDecors);
        } catch (error) {
            // console.error(error);
        }
    }
}

function isIgnored(document: vscode.TextDocument) {
    return utils.config.schemeTypesIgnore.some((scheme) => scheme == document.uri.scheme);
}

/* Decors ------------------------------------------------------------------- */
// init
function initDecorator(document: vscode.TextDocument) {
    return new Promise((resolve, reject) => {
        const { fileName, uri } = document;
        const fileScheme = uri.scheme;

        if (isIgnored(document)) {
            return reject(false);
        }

        if (!utils.config.schemeTypes.some((scheme) => scheme == fileScheme)) {
            utils.showMessage(`file scheme type '${fileScheme}' is not supported`);

            return reject(false);
        }

        if (hasContentFor(fileName)) {
            return reject(false);
        }

        decorRanges.push({
            name: fileName,
            addKey: createDecorator('add'),
            delKey: createDecorator('del'),
            changeKey: createDecorator('change'),
            ranges: {
                add: [],
                del: [],
                change: [],
            },
        });

        documentsContent.push({
            name: fileName,
            history: {
                content: document.getText(),
                lineCount: document.lineCount,
            },
        });

        resolve(true);
    });
}

function createDecorator(type: string): vscode.TextEditorDecorationType {
    let obj = { isWholeLine: utils.config.wholeLine };

    if (utils.config.showInGutter) {
        obj = Object.assign(obj, {
            gutterIconPath: utils.getImgPath(type),
            gutterIconSize: utils.gutterConfig.size,
        });
    }

    if (utils.config.showInOverView) {
        obj = Object.assign(obj, {
            overviewRulerColor: hexToRgba(utils.overviewConfig[type], utils.overviewConfig.opacity),
            overviewRulerLane: 2,
        });
    }

    return vscode.window.createTextEditorDecorationType(obj);
}

function getActiveEditor(): vscode.TextEditor | undefined {
    return vscode.window.activeTextEditor;
}

async function updateDecors(document: vscode.TextDocument) {
    const { fileName } = document;

    return new Promise(async (resolve, reject) => {
        try {
            let decor = getDecorRangesFor(fileName);

            if (!decor) {
                return reject(false);
            }

            const snapshot = getLastSnapshotFor(fileName);
            const results: compare.ContentComparisonResults[] = await compare.compareStreams(
                snapshot.content,
                document.getText(),
            );

            const add: any = [];
            const del: any = [];
            const change: any = [];

            // ranges
            for (const result of results) {
                const lineNumber = result.lineNumber;
                const range = new vscode.Range(lineNumber, 0, lineNumber, 0);

                if (result.del == true) {
                    del.push(range);
                }

                if (result.change == true) {
                    change.push(range);
                }

                if (result.add == true) {
                    add.push(range);
                }
            }

            decor = Object.assign(decor, {
                ranges: {
                    add,
                    del,
                    change,
                },
            });

            // @ts-ignore
            await reApplyDecors(getActiveEditor(), false, decor);

            await setContext(true);

            resolve(true);
        } catch (error) {
            // console.error(error);

            await resetAll(fileName);

            reject(error);
        }
    });
}

async function reApplyDecors(editor: vscode.TextEditor, updateDecors: boolean = false, decor?: utils.DecorRange | any): Promise<unknown> {
    try {
        const { document } = editor;
        const { fileName, isClosed } = document;

        if (!isClosed) {
            decor = decor || getDecorRangesFor(fileName);

            if (decor) {
                if (updateDecors) {
                    decor.addKey.dispose();
                    decor.delKey.dispose();
                    decor.changeKey.dispose();

                    decor = Object.assign(decor, {
                        addKey: createDecorator('add'),
                        delKey: createDecorator('del'),
                        changeKey: createDecorator('change'),
                    })
                }

                return new Promise((resolve) => {
                    const ranges = decor.ranges;

                    editor.setDecorations(decor.addKey, ranges.add);
                    editor.setDecorations(decor.delKey, ranges.del);
                    editor.setDecorations(decor.changeKey, ranges.change);

                    resolve(true);
                });
            }

            await initDecorator(document);
        }
    } catch (error) {
        // console.error(error);
    }
}

function resetAll(docFilename: string): Promise<unknown> {
    return new Promise(async (resolve, reject) => {
        const decor = getDecorRangesFor(docFilename);
        const content = findDocumentsContentFor(docFilename);

        await setContext(false);

        if (!decor && !content) {
            return reject(false);
        }

        if (decor) {
            decor.addKey.dispose();
            decor.delKey.dispose();
            decor.changeKey.dispose();

            decorRanges.splice(decorRanges.indexOf(decor), 1);
        }

        if (content) {
            documentsContent.splice(documentsContent.indexOf(content), 1);
        }

        resolve(true);
    });
}

/* Ranges ------------------------------------------------------------------- */
function getDecorRangesFor(docFilename: string): utils.DecorRange | undefined {
    return decorRanges.find((e) => e.name == docFilename);
}

/* Content ------------------------------------------------------------------ */
function findDocumentsContentFor(docFilename: string): utils.DocumentContent | undefined {
    return documentsContent.find((doc) => doc.name == docFilename);
}

function getLastSnapshotFor(docFilename: string) {
    try {
        const snapshot = findDocumentsContentFor(docFilename);

        return snapshot!.history;
    } catch (error) {
        throw new Error(`'${docFilename}' not found`);
    }
}

function contentNotChanged(document: vscode.TextDocument): boolean {
    const snapshot = getLastSnapshotFor(document.fileName);

    if (snapshot && snapshot.lineCount == document.lineCount) {
        return snapshot.content == document.getText();
    }

    return false;
}

function hasContentFor(fileName: string): boolean {
    return documentsContent.some((item) => item.name == fileName);
}

function setContext(val, key = 'sucFilePath') {
    return vscode.commands.executeCommand('setContext', key, val);
}

function getNearestChangedLineNumber(direction: number): number {
    const editor = getActiveEditor();

    if (editor && !contentNotChanged(editor.document)) {
        const { document, selection } = editor;
        const lineNumbers = getLineNumbersList(document.fileName);

        if (lineNumbers.length) {
            const currentLine = selection.active.line;
            let ln: number | undefined;

            // loop: after / last item in the list + go next
            if (currentLine >= lineNumbers[lineNumbers.length - 1] && direction === 1) {
                ln = lineNumbers[0];
            }

            // loop: before / first item in the list + go prev
            if (currentLine <= lineNumbers[0] && direction === -1) {
                ln = lineNumbers[lineNumbers.length - 1];
            }

            // normal: inside changes range
            if (ln === undefined) {
                if (direction === -1) {
                    ln = lineNumbers.reverse().find((lineNumber) => currentLine > lineNumber);
                } else {
                    ln = lineNumbers.find((lineNumber) => currentLine < lineNumber);
                }
            }

            if (ln !== undefined) {
                const pos = new vscode.Position(ln, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            }
        }
    }

    return 0;
}

function getLineNumbersList(fileName) {
    const decor = getDecorRangesFor(fileName);
    const lineNumbers: number[] = [];

    if (decor) {
        const { ranges } = decor;
        lineNumbers.push(
            ...ranges.add.map((range: vscode.Range) => range.start.line),
            ...ranges.del.map((range: vscode.Range) => range.start.line),
            ...ranges.change.map((range: vscode.Range) => range.start.line),
        );

        return [...new Set(lineNumbers.sort())];
    }

    return [];
}

/* -------------------------------------------------------------------------- */

export function deactivate() { }
