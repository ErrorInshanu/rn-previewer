import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	const provider = new RNPreviewerProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'rnPreviewer.previewView',
			provider
		)
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(event => {
			if (isRNFile(event.document)) {
				provider.updatePreview(event.document.getText());
			}
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && isRNFile(editor.document)) {
				provider.updatePreview(editor.document.getText());
			}
		})
	);
}

function isRNFile(document: vscode.TextDocument): boolean {
	return (
		document.languageId === 'typescriptreact' ||
		document.languageId === 'javascriptreact'
	);
}

class RNPreviewerProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: []
		};
		webviewView.webview.html = this.getHTML('', 'No file open');
	}

	updatePreview(code: string) {
		if (!this._view) return;
		const name = this.extractName(code);
		const wireframe = this.extractElements(code);
		this._view.webview.html = this.getHTML(wireframe, name);
	}

	private extractName(code: string): string {
		const match = code.match(/const\s+([A-Z][a-zA-Z]+)\s*=/);
		return match ? match[1] : 'Component';
	}

	private extractElements(code: string): string {
		let html = '';
		if (code.includes('<View')) html += `<div class="wf-view"></div>`;
		if (code.includes('<Text')) html += `<div class="wf-text"><div class="wf-line"></div><div class="wf-line short"></div></div>`;
		if (code.includes('<Image')) html += `<div class="wf-image"><div class="wf-circle"></div></div>`;
		if (code.includes('<TouchableOpacity') || code.includes('<Pressable')) html += `<div class="wf-button">BUTTON</div>`;
		if (code.includes('<TextInput')) html += `<div class="wf-input"></div>`;
		if (code.includes('<FlatList') || code.includes('<ScrollView')) {
			html += `<div class="wf-list-item"></div><div class="wf-list-item"></div><div class="wf-list-item"></div>`;
		}
		return html || `<div class="empty">Open a React Native file</div>`;
	}

	private getHTML(wireframe: string, name: string): string {
		return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background:#1e1e1e; color:#ccc;
    font-family: -apple-system, sans-serif;
    font-size:12px;
    display:flex; flex-direction:column;
    align-items:center; padding:16px 8px;
  }
  .live {
    align-self:flex-end;
    color:#4ec9b0; font-size:11px;
    display:flex; align-items:center; gap:4px;
    margin-bottom:12px;
  }
  .live::before {
    content:''; width:8px; height:8px;
    background:#4ec9b0; border-radius:50%;
  }
  .phone {
    width:160px; height:320px;
    background:#2d2d2d;
    border:3px solid #555;
    border-radius:28px;
    overflow:hidden;
    display:flex; flex-direction:column;
  }
  .notch {
    width:60px; height:10px;
    background:#1e1e1e;
    border-radius:0 0 8px 8px;
    margin:0 auto;
  }
  .screen {
    flex:1; padding:8px;
    overflow:hidden;
  }
  .home {
    width:40px; height:3px;
    background:#555; border-radius:2px;
    margin:4px auto;
  }
  .wf-view {
    height:24px; background:#3a3a3a;
    border:1px dashed #555;
    border-radius:3px; margin-bottom:4px;
  }
  .wf-text { margin-bottom:6px; }
  .wf-line {
    height:6px; background:#555;
    border-radius:3px; margin-bottom:3px;
  }
  .wf-line.short { width:60%; }
  .wf-circle {
    width:36px; height:36px;
    background:#444; border-radius:50%;
    margin-bottom:4px;
  }
  .wf-button {
    height:22px; border:1.5px solid #666;
    border-radius:11px;
    display:flex; align-items:center;
    justify-content:center;
    font-size:8px; color:#888;
    margin-bottom:4px;
  }
  .wf-input {
    height:18px; background:#2a2a2a;
    border:1px solid #555;
    border-radius:4px; margin-bottom:4px;
  }
  .wf-list-item {
    height:28px; background:#333;
    border-radius:4px; margin-bottom:4px;
  }
  .empty { color:#555; font-size:11px; text-align:center; margin-top:20px; }
  .info {
    width:100%; margin-top:12px;
    border-top:1px solid #333; padding-top:10px;
  }
  .info-row {
    display:flex; gap:6px;
    margin-bottom:4px; font-size:11px;
  }
  .label { color:#888; }
  .value { color:#9cdcfe; }
</style>
</head>
<body>
  <div class="live">Live</div>
  <div class="phone">
    <div class="notch"></div>
    <div class="screen">${wireframe}</div>
    <div class="home"></div>
  </div>
  <div class="info">
    <div class="info-row">
      <span class="label">COMPONENT:</span>
      <span class="value">${name}</span>
    </div>
    <div class="info-row">
      <span class="label">PLATFORM:</span>
      <span class="value">iOS</span>
    </div>
  </div>
</body>
</html>`;
	}
}

export function deactivate() {}