'use strict';

import * as vscode from 'vscode';
import { ASMHoverProvider } from "./hover";
// import { ASMTypingFormatter } from "./formatter";
import { ASMSymbolDocumenter } from "./symbolDocumenter";
import { ASMCompletionProposer } from './completionProposer';
import { ASMDefinitionProvider } from './definitionProvider';
import { ASMDocumentSymbolProvider } from './documentSymbolProvider';
import { ASMWorkspaceSymbolProvider } from './workspaceSymbolProvider';

export function activate(context: vscode.ExtensionContext) {
  const symbolDocumenter = new ASMSymbolDocumenter();

  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: "gbz80", scheme: "file" }, new ASMHoverProvider(symbolDocumenter)));
  // context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider({ language: "gbz80", scheme: "file" }, new ASMTypingFormatter(), " ", ",", ";"));
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider({ language: "gbz80", scheme: "file" }, new ASMCompletionProposer(symbolDocumenter)));
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ language: "gbz80", scheme: "file" }, new ASMDefinitionProvider(symbolDocumenter)));
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider({ language: "gbz80", scheme: "file" }, new ASMDocumentSymbolProvider(symbolDocumenter)));
  context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(new ASMWorkspaceSymbolProvider(symbolDocumenter)));
}

// this method is called when your extension is deactivated
export function deactivate() {
}