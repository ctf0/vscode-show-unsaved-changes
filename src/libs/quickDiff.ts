import path from 'node:path'
import {execa} from 'execa'
import * as vscode from 'vscode'
import * as state from './state'
import * as utils from './utils'

const SCHEME = 'suc-snapshot'

/* Snapshot Provider -------------------------------------------------------- */
// read-only provider serving the last unsaved snapshot, so the built-in
// diff editor (peek + gutter) can compare against it without temp files
const snapshotProvider: vscode.FileSystemProvider = {
    onDidChangeFile : new vscode.EventEmitter<vscode.FileChangeEvent[]>().event,
    stat(uri: vscode.Uri) {
        const content = getSnapshotContent(uri)

        return {
            type : vscode.FileType.File,
            ctime: 0,
            mtime: 0,
            size : Buffer.byteLength(content, 'utf8'),
        }
    },
    readFile(uri: vscode.Uri) {
        return Buffer.from(getSnapshotContent(uri), 'utf8')
    },
    watch() { return new vscode.Disposable(() => {}) },
    // read-only — mutations are not supported
    readDirectory() { return [] },
    createDirectory() { throw vscode.FileSystemError.NoPermissions() },
    writeFile() { throw vscode.FileSystemError.NoPermissions() },
    delete() { throw vscode.FileSystemError.NoPermissions() },
    rename() { throw vscode.FileSystemError.NoPermissions() },
}

function getSnapshotContent(uri: vscode.Uri): string {
    if (!state.hasContentFor(uri.fsPath)) {
        throw vscode.FileSystemError.FileNotFound(uri)
    }

    return state.getLastSnapshotFor(uri.fsPath).content
}

/* QuickDiff ----------------------------------------------------------------- */
// replaces the custom gutter for file scheme docs inside a git repo;
// native git handles tracked files, we handle the rest
async function provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | null> {
    if (uri.scheme !== 'file' || !state.hasContentFor(uri.fsPath)) {
        return null
    }

    // run git from the file's dir so it walks up to the enclosing repo;
    // the extension host cwd is not guaranteed to be inside the repo
    const cwd = path.dirname(uri.fsPath)
    const {exitCode} = await execa(utils.config.gitPath, ['check-ignore', '-q', uri.fsPath], {reject: false, cwd})

    // not ignored → native git can only diff files that exist in HEAD
    // (tracked); staged-new and untracked files have no HEAD blob
    if (exitCode === 1) {
        const {stdout} = await execa(utils.config.gitPath, ['ls-tree', 'HEAD', '--', uri.fsPath], {reject: false, cwd})

        if (stdout.trim() !== '') {
            return null
        }
    }

    // exit 0 (ignored), staged-new, untracked, or error (not a git repo / no git) → we handle
    return vscode.Uri.parse(`${SCHEME}:${encodeURIComponent(uri.fsPath)}`)
}

export function register(context: vscode.ExtensionContext) {
    const scm = vscode.scm.createSourceControl(`${utils.PKG_ID}.snapshot`, utils.PKG_LABEL)

    scm.inputBox.visible = false
    scm.quickDiffProvider = {provideOriginalResource}

    context.subscriptions.push(
        scm,
        vscode.workspace.registerFileSystemProvider(SCHEME, snapshotProvider, {isReadonly: true, isCaseSensitive: true}),
    )
}
