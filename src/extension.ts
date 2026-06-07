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
	private _lastCode: string = '';

	constructor(private readonly _extensionUri: vscode.Uri) {}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: []
		};
		webviewView.webview.html = this.getHTML('', 'No file open');

		webviewView.webview.onDidReceiveMessage(message => {
			if (message.command === 'update') {
				this._view!.webview.html = this.getHTML(
					this.extractElements(this._lastCode),
					this.extractName(this._lastCode)
				);
			}
		});
	}

	updatePreview(code: string) {
		if (!this._view) { return; }
		this._lastCode = code;
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
		if (code.includes('<View')) { html += `<div class="wf-view"></div>`; }
		if (code.includes('<Text')) { html += `<div class="wf-text"><div class="wf-line"></div><div class="wf-line short"></div></div>`; }
		if (code.includes('<Image')) { html += `<div class="wf-image"><div class="wf-circle"></div></div>`; }
		if (code.includes('<TouchableOpacity') || code.includes('<Pressable')) { html += `<div class="wf-button">BUTTON</div>`; }
		if (code.includes('<TextInput')) { html += `<div class="wf-input"></div>`; }
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
    align-items:center; padding:12px 8px;
  }
  body.light {
    background:#f0f0f0; color:#333;
  }

  /* Toolbar */
  .toolbar {
    width:100%;
    display:flex;
    gap:4px;
    margin-bottom:10px;
    flex-wrap:wrap;
  }
  .btn {
    flex:1;
    padding:4px 6px;
    border-radius:6px;
    border:1px solid #444;
    background:#2a2a2a;
    color:#ccc;
    font-size:10px;
    cursor:pointer;
    text-align:center;
  }
  .btn.active {
    background:#0e639c;
    border-color:#0e639c;
    color:#fff;
  }
  body.light .btn {
    background:#e0e0e0;
    border-color:#bbb;
    color:#333;
  }
  body.light .btn.active {
    background:#0e639c;
    color:#fff;
  }

  /* Size selector */
  .size-row {
    width:100%;
    display:flex;
    gap:4px;
    margin-bottom:10px;
  }
  .size-btn {
    flex:1;
    padding:3px 4px;
    border-radius:5px;
    border:1px solid #444;
    background:#2a2a2a;
    color:#888;
    font-size:9px;
    cursor:pointer;
    text-align:center;
  }
  .size-btn.active {
    border-color:#4ec9b0;
    color:#4ec9b0;
  }
  body.light .size-btn {
    background:#e0e0e0;
    border-color:#bbb;
    color:#666;
  }
  body.light .size-btn.active {
    border-color:#0e639c;
    color:#0e639c;
  }

  /* Live dot */
  .live {
    align-self:flex-end;
    color:#4ec9b0; font-size:11px;
    display:flex; align-items:center; gap:4px;
    margin-bottom:8px;
  }
  .live::before {
    content:''; width:8px; height:8px;
    background:#4ec9b0; border-radius:50%;
  }

  /* iPhone frame */
  .phone {
    background:#2d2d2d;
    border:3px solid #555;
    border-radius:28px;
    overflow:hidden;
    display:flex; flex-direction:column;
    transition: all 0.2s ease;
    flex-shrink:0;
  }
  body.light .phone {
    background:#fff;
    border-color:#999;
  }
  .notch {
    width:60px; height:10px;
    background:#1e1e1e;
    border-radius:0 0 8px 8px;
    margin:0 auto;
    transition: all 0.2s;
  }
  body.light .notch { background:#ddd; }

  /* Android frame */
  .phone.android {
    border-radius:16px;
    border-width:4px;
  }
  .phone.android .notch {
    width:12px; height:12px;
    border-radius:50%;
    margin:6px auto 0;
  }
  .phone.android .home {
    width:20px; height:20px;
    border-radius:50%;
    border:2px solid #555;
    background:transparent;
    margin:6px auto;
  }
  body.light .phone.android .home {
    border-color:#999;
  }

  .screen {
    flex:1; padding:8px;
    overflow:hidden;
  }
  .home {
    width:40px; height:3px;
    background:#555; border-radius:2px;
    margin:4px auto;
    transition: all 0.2s;
  }
  body.light .home { background:#999; }

  /* Wireframe elements */
  .wf-view {
    height:24px; background:#3a3a3a;
    border:1px dashed #555;
    border-radius:3px; margin-bottom:4px;
  }
  body.light .wf-view { background:#ddd; border-color:#aaa; }

  .wf-text { margin-bottom:6px; }
  .wf-line {
    height:6px; background:#555;
    border-radius:3px; margin-bottom:3px;
  }
  body.light .wf-line { background:#aaa; }
  .wf-line.short { width:60%; }

  .wf-circle {
    width:36px; height:36px;
    background:#444; border-radius:50%;
    margin-bottom:4px;
  }
  body.light .wf-circle { background:#bbb; }

  .wf-button {
    height:22px; border:1.5px solid #666;
    border-radius:11px;
    display:flex; align-items:center;
    justify-content:center;
    font-size:8px; color:#888;
    margin-bottom:4px;
  }
  body.light .wf-button { border-color:#aaa; color:#777; }

  .wf-input {
    height:18px; background:#2a2a2a;
    border:1px solid #555;
    border-radius:4px; margin-bottom:4px;
  }
  body.light .wf-input { background:#eee; border-color:#aaa; }

  .wf-list-item {
    height:28px; background:#333;
    border-radius:4px; margin-bottom:4px;
  }
  body.light .wf-list-item { background:#ddd; }

  .empty { color:#555; font-size:11px; text-align:center; margin-top:20px; }

  /* Info bar */
  .info {
    width:100%; margin-top:12px;
    border-top:1px solid #333; padding-top:10px;
  }
  body.light .info { border-color:#ccc; }
  .info-row {
    display:flex; gap:6px;
    margin-bottom:4px; font-size:11px;
  }
  .label { color:#888; }
  .value { color:#9cdcfe; }
  body.light .value { color:#0e639c; }
</style>
</head>
<body id="body">

  <!-- Toolbar: Platform toggle -->
  <div class="toolbar">
    <div class="btn active" id="btn-ios" onclick="setPlatform('ios')">iOS</div>
    <div class="btn" id="btn-android" onclick="setPlatform('android')">Android</div>
    <div class="btn" id="btn-theme" onclick="toggleTheme()">☀ Light</div>
  </div>

  <!-- Size selector -->
  <div class="size-row">
    <div class="size-btn" id="size-se" onclick="setSize('se')">SE</div>
    <div class="size-btn active" id="size-15" onclick="setSize('15')">iPhone 15</div>
    <div class="size-btn" id="size-ipad" onclick="setSize('ipad')">iPad</div>
  </div>

  <div class="live">Live</div>

  <!-- Phone Frame -->
  <div class="phone" id="phone">
    <div class="notch" id="notch"></div>
    <div class="screen" id="screen">${wireframe}</div>
    <div class="home" id="home"></div>
  </div>

  <!-- Info Bar -->
  <div class="info">
    <div class="info-row">
      <span class="label">COMPONENT:</span>
      <span class="value" id="comp-name">${name}</span>
    </div>
    <div class="info-row">
      <span class="label">PLATFORM:</span>
      <span class="value" id="platform-label">iOS</span>
    </div>
    <div class="info-row">
      <span class="label">SIZE:</span>
      <span class="value" id="size-label">iPhone 15</span>
    </div>
  </div>

<script>
  const sizes = {
    se:    { w: 130, h: 260, label: 'iPhone SE' },
    '15':  { w: 160, h: 320, label: 'iPhone 15' },
    ipad:  { w: 220, h: 300, label: 'iPad' }
  };

  let currentSize = '15';
  let currentPlatform = 'ios';
  let isDark = true;

  function setSize(s) {
    currentSize = s;
    const phone = document.getElementById('phone');
    phone.style.width = sizes[s].w + 'px';
    phone.style.height = sizes[s].h + 'px';
    document.getElementById('size-label').textContent = sizes[s].label;
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('size-' + s).classList.add('active');

    // iPad has bigger notch
    if (s === 'ipad') {
      document.getElementById('notch').style.width = '80px';
    } else {
      document.getElementById('notch').style.width = currentPlatform === 'android' ? '12px' : '60px';
    }
  }

  function setPlatform(p) {
    currentPlatform = p;
    const phone = document.getElementById('phone');
    if (p === 'android') {
      phone.classList.add('android');
      document.getElementById('platform-label').textContent = 'Android';
    } else {
      phone.classList.remove('android');
      document.getElementById('platform-label').textContent = 'iOS';
    }
    document.getElementById('btn-ios').classList.toggle('active', p === 'ios');
    document.getElementById('btn-android').classList.toggle('active', p === 'android');
  }

  function toggleTheme() {
    isDark = !isDark;
    document.getElementById('body').className = isDark ? '' : 'light';
    document.getElementById('btn-theme').textContent = isDark ? '☀ Light' : '🌙 Dark';
  }

  // Set default size on load
  setSize('15');
</script>
</body>
</html>`;
	}
}

export function deactivate() {}