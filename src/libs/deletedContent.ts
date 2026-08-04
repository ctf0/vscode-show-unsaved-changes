import * as vscode from 'vscode'
import * as utils from './utils'
import * as state from './state'
import type {ContentComparisonResults} from './Compare'

let commentController: vscode.CommentController

export function registerCommentController(context: vscode.ExtensionContext) {
    commentController = vscode.comments.createCommentController(`${utils.PKG_ID}.deletedLines`, utils.PKG_LABEL)
    context.subscriptions.push(commentController)
}

/* Deleted Content ---------------------------------------------------------- */
export function storeDeletedLines(fileName: string, results: ContentComparisonResults[], lineCount: number) {
    const lines = new Map<number, string[]>()

    const groups: ContentComparisonResults[][] = utils.groupConsecutiveLines(
        results.filter((result) => result.del),
        'oldLineNumber',
    )

    for (const group of groups) {
        const anchor = Math.max(0, Math.min(group[0].lineNumber, lineCount - 1))

        lines.set(anchor, group.map((result) => result.lineValue))
    }

    state.deletedLines.set(fileName, lines)
    state.deletedAt.set(fileName, new Date().toLocaleTimeString())
}

/* Comment Threads ---------------------------------------------------------- */
export async function updateCommentThreads(document: vscode.TextDocument) {
    const oldThreads = state.commentThreads.get(document.fileName) ?? []

    disposeThreadsFor(document.fileName)

    if (utils.config.showDeletedContent !== 'comments') {
        return
    }

    const lines = state.deletedLines.get(document.fileName)

    if (!lines || lines.size === 0) {
        return
    }

    const expandedLines = new Set(
        oldThreads
            .filter((thread) => thread.collapsibleState === vscode.CommentThreadCollapsibleState.Expanded)
            .map((thread) => thread.range?.start.line),
    )

    const threads: vscode.CommentThread[] = []

    for (const [lineNumber, content] of lines) {
        const anchor = Math.max(0, Math.min(lineNumber, document.lineCount - 1))
        const body = getMdRender(content, document)

        const thread = commentController.createCommentThread(
            document.uri,
            new vscode.Range(anchor, 0, anchor, 0),
            [{
                body   : body,
                author : {
                    name : '⏲ ' + (state.deletedAt.get(document.fileName) ?? ''),
                },
                mode         : vscode.CommentMode.Preview,
                contextValue : 'suc.deleted-lines',
            }],
        )

        thread.canReply = false
        thread.collapsibleState = expandedLines.has(anchor)
            ? vscode.CommentThreadCollapsibleState.Expanded
            : vscode.CommentThreadCollapsibleState.Collapsed
        thread.label = utils.PKG_LABEL

        threads.push(thread)
    }

    state.commentThreads.set(document.fileName, threads)
}

export function disposeThreadsFor(fileName: string) {
    const threads = state.commentThreads.get(fileName)

    if (threads) {
        for (const thread of threads) {
            thread.dispose()
        }

        state.commentThreads.delete(fileName)
    }
}

export function disposeAllThreads() {
    for (const fileName of [...state.commentThreads.keys()]) {
        disposeThreadsFor(fileName)
    }
}

/* Markdown ----------------------------------------------------------------- */
export function getMdRender(content: string[], document: vscode.TextDocument) {
    const body = new vscode.MarkdownString()
    body.appendCodeblock(normalizeIndentation(content.join('\n')), document.languageId)
    body.isTrusted = true
    body.supportHtml = true
    body.supportThemeIcons = true

    return body
}

function normalizeIndentation(text: string): string {
    const lines = text.split('\n')

    // Find all lines with actual text content to measure their leading spaces
    const contentLines = lines.filter((line) => line.trim().length > 0)

    if (contentLines.length === 0) {
        return text
    }

    // Calculate the lowest common number of leading spaces across lines
    const minIndent = Math.min(...contentLines.map((line) => {
        const match = line.match(/^([ \t]*)/)

        return match ? match[0].length : 0
    }))

    // Strip exactly that amount of leading whitespace from every line
    return lines
        .map((line) => line.slice(minIndent))
        .join('\n')
        .trim() // Cleans up leading/trailing empty lines
}
