import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Component without styles renders generic fallback boxes', () => {
		const code = `
			import React from 'react';
			import { View, Text } from 'react-native';

			export default function App() {
				return (
					<View>
						<Text />
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.strictEqual(res.name, 'App');
		assert.strictEqual(
			res.wireframe,
			'<div class="wf-view" data-line="6"><div class="wf-text" data-line="7"><div class="wf-line"></div><div class="wf-line short"></div></div></div>'
		);
	});

	test('Extracts static text content from Text elements', () => {
		const code = `
			import React from 'react';
			import { View, Text } from 'react-native';

			export default function App() {
				return (
					<View>
						<Text>Hello World</Text>
						<Text>{'Static Expression'}</Text>
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('<div class="wf-text">Hello World</div>'));
		assert.ok(res.wireframe.includes('<div class="wf-text">Static Expression</div>'));
	});

	test('Truncates long text and HTML-escapes content', () => {
		const code = `
			import React from 'react';
			import { View, Text } from 'react-native';

			export default function App() {
				return (
					<View>
						<Text>This is an extremely long piece of text that definitely goes beyond forty characters in length</Text>
						<Text>{'<hello> & "quotes"'}</Text>
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('This is an extremely long piece of text...'));
		assert.ok(res.wireframe.includes('&lt;hello&gt; &amp; &quot;quotes&quot;'));
	});

	test('Falls back to placeholder lines for dynamic text', () => {
		const code = `
			import React from 'react';
			import { View, Text } from 'react-native';

			export default function App() {
				return (
					<View>
						<Text>{dynamicContent}</Text>
						<Text>{\`Hello \${name}\`}</Text>
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('<div class="wf-text"><div class="wf-line"></div><div class="wf-line short"></div></div>'));
	});

	test('Extracts nested Text as uppercase label for button-like elements', () => {
		const code = `
			import React from 'react';
			import { View, TouchableOpacity, Pressable, TouchableHighlight, TouchableWithoutFeedback, Text } from 'react-native';

			export default function App() {
				return (
					<View>
						<TouchableOpacity><Text>Save Changes</Text></TouchableOpacity>
						<Pressable><View><Text>{'Sign In'}</Text></View></Pressable>
						<TouchableHighlight><Text>Delete</Text></TouchableHighlight>
						<TouchableWithoutFeedback><Text>Dismiss</Text></TouchableWithoutFeedback>
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('<div class="wf-button">SAVE CHANGES</div>'));
		assert.ok(res.wireframe.includes('<div class="wf-button">SIGN IN</div>'));
		assert.ok(res.wireframe.includes('<div class="wf-button">DELETE</div>'));
		assert.ok(res.wireframe.includes('<div class="wf-button">DISMISS</div>'));
	});

	test('Falls back to BUTTON when no static nested text is present', () => {
		const code = `
			import React from 'react';
			import { View, TouchableOpacity, Pressable, Text } from 'react-native';

			export default function App() {
				return (
					<View>
						<TouchableOpacity />
						<Pressable><Text>{dynamicTitle}</Text></Pressable>
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('<div class="wf-button">BUTTON</div>'));
	});

	test('Extracts TextInput placeholder prop', () => {
		const code = `
			import React from 'react';
			import { View, TextInput } from 'react-native';

			export default function App() {
				return (
					<View>
						<TextInput placeholder="Search items..." />
						<TextInput placeholder={'Static Input'} />
						<TextInput placeholder={dynamicPlaceholder} />
						<TextInput />
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('Search items...'));
		assert.ok(res.wireframe.includes('Static Input'));
		assert.ok(res.wireframe.includes('<div class="wf-input"></div>'));
	});

	test('Resolves StyleSheet styles with height and backgroundColor', () => {
		const code = `
			import React from 'react';
			import { View, StyleSheet } from 'react-native';

			export default function App() {
				return <View style={styles.container} />;
			}

			const styles = StyleSheet.create({
				container: {
					height: 120,
					backgroundColor: '#333'
				}
			});
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('style="height: 120px; background: #333"'));
	});

	test('Applies display:flex; flex-direction:row for flexDirection: row', () => {
		const code = `
			import React from 'react';
			import { View, StyleSheet } from 'react-native';

			export default function App() {
				return (
					<View style={styles.row}>
						<View style={styles.box} />
					</View>
				);
			}

			const styles = StyleSheet.create({
				row: {
					flexDirection: 'row'
				},
				box: {
					width: 50,
					height: 50
				}
			});
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('style="display:flex; flex-direction:row"'));
		assert.ok(res.wireframe.includes('style="width: 50px; height: 50px"'));
	});

	test('Resolves inline styles', () => {
		const code = `
			import React from 'react';
			import { View } from 'react-native';

			export default function App() {
				return <View style={{ width: 100, height: 100, backgroundColor: 'red' }} />;
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('style="width: 100px; height: 100px; background: red"'));
	});

	test('Merges array styles with overrides', () => {
		const code = `
			import React from 'react';
			import { View, StyleSheet } from 'react-native';

			export default function App() {
				return <View style={[styles.box, styles.override, { borderRadius: 8 }]} />;
			}

			const styles = StyleSheet.create({
				box: {
					width: 60,
					height: 60,
					backgroundColor: '#111'
				},
				override: {
					backgroundColor: '#222'
				}
			});
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('width: 60px'));
		assert.ok(res.wireframe.includes('height: 60px'));
		assert.ok(res.wireframe.includes('background: #222'));
		assert.ok(res.wireframe.includes('border-radius: 8px'));
	});

	test('Gracefully ignores unresolvable styles and spreads without throwing', () => {
		const code = `
			import React from 'react';
			import { View, StyleSheet } from 'react-native';

			export default function App() {
				return <View style={[styles.card, externalStyle]} />;
			}

			const styles = StyleSheet.create({
				card: {
					...unknownSpread,
					height: 80
				}
			});
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('style="height: 80px"'));
	});

	test('Ignores non-visual styles like elevation and shadowOffset', () => {
		const code = `
			import React from 'react';
			import { View, StyleSheet } from 'react-native';

			export default function App() {
				return <View style={styles.card} />;
			}

			const styles = StyleSheet.create({
				card: {
					elevation: 5,
					shadowOffset: { width: 0, height: 2 }
				}
			});
		`;
		const res = myExtension.parseReactNativeComponent(code);
		// With only ignored styles, no style attribute should be added
		assert.strictEqual(res.wireframe, '<div class="wf-view" data-line="6"></div>');
	});

	test('Resolves local constants used in styles', () => {
		const code = `
			import React from 'react';
			import { View, StyleSheet } from 'react-native';

			const CARD_HEIGHT = 150;

			export default function App() {
				return <View style={styles.card} />;
			}

			const styles = StyleSheet.create({
				card: {
					height: CARD_HEIGHT
				}
			});
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.ok(res.wireframe.includes('style="height: 150px"'));
	});

	test('Attaches data-line attribute to wireframe elements for click-to-source', () => {
		const code = `
			import React from 'react';
			import { View, Text, TouchableOpacity, TextInput } from 'react-native';

			export default function Profile() {
				return (
					<View>
						<Text>Hello</Text>
						<TouchableOpacity>
							<Text>Submit</Text>
						</TouchableOpacity>
						<TextInput placeholder="Enter name" />
					</View>
				);
			}
		`;
		const res = myExtension.parseReactNativeComponent(code);
		assert.strictEqual(res.name, 'Profile');
		assert.ok(res.wireframe.includes('<div class="wf-view" data-line="7">'));
		assert.ok(res.wireframe.includes('<div class="wf-text" data-line="8">Hello</div>'));
		assert.ok(res.wireframe.includes('<div class="wf-button" data-line="9">SUBMIT</div>'));
		assert.ok(res.wireframe.includes('<div class="wf-input" data-line="12">'));
	});
});
