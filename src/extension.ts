import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as babelTypes from '@babel/types';

// Babel traverse CJS/ESM interop
const traverse = (typeof (traverseModule as any).default === 'function'
	? (traverseModule as any).default
	: traverseModule) as typeof traverseModule;

const t = babelTypes;

function getTagName(node: babelTypes.JSXElement): string {
	const nameNode = node.openingElement.name;
	if (t.isJSXIdentifier(nameNode)) {
		return nameNode.name;
	}
	if (t.isJSXMemberExpression(nameNode)) {
		return nameNode.property.name;
	}
	return '';
}

function getFullTagName(node: babelTypes.JSXElement): string {
	const nameNode = node.openingElement.name;
	if (t.isJSXIdentifier(nameNode)) {
		return nameNode.name;
	}
	if (t.isJSXMemberExpression(nameNode)) {
		const objName = t.isJSXIdentifier(nameNode.object) ? nameNode.object.name : '';
		return objName ? `${objName}.${nameNode.property.name}` : nameNode.property.name;
	}
	return '';
}

function unwrapExpression(node: babelTypes.Node | null | undefined): babelTypes.Node | null | undefined {
	let curr = node;
	while (curr) {
		if (t.isParenthesizedExpression(curr)) {
			curr = curr.expression;
		} else if (
			t.isTSAsExpression(curr) ||
			t.isTSTypeAssertion(curr) ||
			t.isTSSatisfiesExpression(curr) ||
			t.isTSNonNullExpression(curr)
		) {
			curr = curr.expression;
		} else {
			break;
		}
	}
	return curr;
}

function isStyleSheetCreate(node: babelTypes.CallExpression): boolean {
	const callee = unwrapExpression(node.callee);
	if (callee && t.isMemberExpression(callee)) {
		const obj = unwrapExpression(callee.object);
		const prop = callee.property;
		if (
			obj &&
			t.isIdentifier(obj) &&
			obj.name === 'StyleSheet' &&
			t.isIdentifier(prop) &&
			prop.name === 'create'
		) {
			return true;
		}
	}
	return false;
}

function formatDimension(val: any): string {
	if (typeof val === 'number') {
		return `${val}px`;
	}
	if (typeof val === 'string') {
		const trimmed = val.trim();
		if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
			return `${trimmed}px`;
		}
		return trimmed;
	}
	return String(val);
}

function resolveStaticValue(
	node: babelTypes.Node | null | undefined,
	fileConstants: Map<string, any>
): any {
	if (!node) {
		return undefined;
	}
	node = unwrapExpression(node);
	if (!node) {
		return undefined;
	}

	if (t.isNumericLiteral(node)) {
		return node.value;
	}
	if (t.isStringLiteral(node)) {
		return node.value;
	}
	if (t.isBooleanLiteral(node)) {
		return node.value;
	}
	if (t.isNullLiteral(node)) {
		return null;
	}
	if (t.isUnaryExpression(node)) {
		const argVal = resolveStaticValue(node.argument, fileConstants);
		if (typeof argVal === 'number') {
			if (node.operator === '-') {
				return -argVal;
			}
			if (node.operator === '+') {
				return argVal;
			}
		}
		return undefined;
	}
	if (t.isBinaryExpression(node)) {
		const left = resolveStaticValue(node.left, fileConstants);
		const right = resolveStaticValue(node.right, fileConstants);
		if (typeof left === 'number' && typeof right === 'number') {
			switch (node.operator) {
				case '+': return left + right;
				case '-': return left - right;
				case '*': return left * right;
				case '/': return right !== 0 ? left / right : undefined;
			}
		}
		if (node.operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
			return String(left) + String(right);
		}
		return undefined;
	}
	if (t.isIdentifier(node)) {
		if (node.name === 'undefined') {
			return undefined;
		}
		if (fileConstants.has(node.name)) {
			return fileConstants.get(node.name);
		}
		return undefined;
	}
	if (t.isTemplateLiteral(node)) {
		if (node.expressions.length === 0 && node.quasis.length === 1) {
			return node.quasis[0].value.raw;
		}
		let str = '';
		for (let i = 0; i < node.quasis.length; i++) {
			str += node.quasis[i].value.raw;
			if (i < node.expressions.length) {
				const exprVal = resolveStaticValue(node.expressions[i] as babelTypes.Node, fileConstants);
				if (exprVal === undefined) {
					return undefined;
				}
				str += String(exprVal);
			}
		}
		return str;
	}

	return undefined;
}

function extractStyleObject(
	objExpr: babelTypes.ObjectExpression,
	fileConstants: Map<string, any>
): Record<string, any> {
	const result: Record<string, any> = {};

	for (const prop of objExpr.properties) {
		if (t.isObjectProperty(prop)) {
			let propKey: string | null = null;
			if (t.isIdentifier(prop.key) && !prop.computed) {
				propKey = prop.key.name;
			} else if (t.isStringLiteral(prop.key)) {
				propKey = prop.key.value;
			}

			if (!propKey) {
				continue;
			}

			const val = resolveStaticValue(prop.value, fileConstants);
			if (val !== undefined) {
				result[propKey] = val;
			}
		}
	}

	return result;
}

function extractStyleSheetEntries(
	objExpr: babelTypes.ObjectExpression,
	fileConstants: Map<string, any>
): Map<string, Record<string, any>> {
	const entries = new Map<string, Record<string, any>>();

	for (const prop of objExpr.properties) {
		if (t.isObjectProperty(prop)) {
			let keyName: string | null = null;
			if (t.isIdentifier(prop.key) && !prop.computed) {
				keyName = prop.key.name;
			} else if (t.isStringLiteral(prop.key)) {
				keyName = prop.key.value;
			}

			if (!keyName) {
				continue;
			}

			const valNode = unwrapExpression(prop.value);
			if (valNode && t.isObjectExpression(valNode)) {
				const styleObj = extractStyleObject(valNode, fileConstants);
				entries.set(keyName, styleObj);
			}
		}
	}

	return entries;
}

function resolveStyleExpression(
	expr: babelTypes.Node | null | undefined,
	styleSheets: Map<string, Map<string, Record<string, any>>>,
	allStylesByKey: Map<string, Record<string, any>>,
	fileConstants: Map<string, any>
): Record<string, any> | null {
	if (!expr) {
		return null;
	}
	expr = unwrapExpression(expr);
	if (!expr) {
		return null;
	}

	if (t.isObjectExpression(expr)) {
		return extractStyleObject(expr, fileConstants);
	}

	if (t.isMemberExpression(expr)) {
		let objName = '';
		const obj = unwrapExpression(expr.object);
		if (obj && t.isIdentifier(obj)) {
			objName = obj.name;
		}

		let propName = '';
		if (t.isIdentifier(expr.property) && !expr.computed) {
			propName = expr.property.name;
		} else if (t.isStringLiteral(expr.property)) {
			propName = expr.property.value;
		}

		if (propName) {
			if (objName && styleSheets.has(objName)) {
				const sheet = styleSheets.get(objName);
				if (sheet && sheet.has(propName)) {
					return { ...sheet.get(propName) };
				}
			}
			if (allStylesByKey.has(propName)) {
				return { ...allStylesByKey.get(propName) };
			}
		}
		return null;
	}

	if (t.isIdentifier(expr)) {
		if (allStylesByKey.has(expr.name)) {
			return { ...allStylesByKey.get(expr.name) };
		}
		const val = fileConstants.get(expr.name);
		if (val && typeof val === 'object') {
			return { ...val };
		}
		return null;
	}

	if (t.isArrayExpression(expr)) {
		const merged: Record<string, any> = {};
		let hasAny = false;
		for (const elem of expr.elements) {
			if (elem && !t.isSpreadElement(elem)) {
				const resolved = resolveStyleExpression(elem, styleSheets, allStylesByKey, fileConstants);
				if (resolved) {
					Object.assign(merged, resolved);
					hasAny = true;
				}
			}
		}
		return hasAny ? merged : null;
	}

	if (t.isConditionalExpression(expr)) {
		const consequent = resolveStyleExpression(expr.consequent, styleSheets, allStylesByKey, fileConstants);
		if (consequent) {
			return consequent;
		}
		return resolveStyleExpression(expr.alternate, styleSheets, allStylesByKey, fileConstants);
	}

	if (t.isLogicalExpression(expr)) {
		return resolveStyleExpression(expr.right, styleSheets, allStylesByKey, fileConstants);
	}

	return null;
}

function convertStyleToCSS(styleObj: Record<string, any>): string {
	const cssProps: string[] = [];

	// Display & Flex Direction
	if (styleObj.display !== undefined) {
		cssProps.push(`display: ${styleObj.display}`);
		if (styleObj.flexDirection !== undefined) {
			cssProps.push(`flex-direction:${styleObj.flexDirection}`);
		}
	} else if (styleObj.flexDirection !== undefined) {
		cssProps.push('display:flex');
		cssProps.push(`flex-direction:${styleObj.flexDirection}`);
	} else if (
		styleObj.justifyContent !== undefined ||
		styleObj.alignItems !== undefined
	) {
		cssProps.push('display:flex');
		cssProps.push('flex-direction:column');
	}

	if (styleObj.justifyContent !== undefined) {
		cssProps.push(`justify-content: ${styleObj.justifyContent}`);
	}
	if (styleObj.alignItems !== undefined) {
		cssProps.push(`align-items: ${styleObj.alignItems}`);
	}
	if (styleObj.alignSelf !== undefined) {
		cssProps.push(`align-self: ${styleObj.alignSelf}`);
	}
	if (styleObj.flex !== undefined) {
		cssProps.push(`flex: ${styleObj.flex}`);
	}
	if (styleObj.flexGrow !== undefined) {
		cssProps.push(`flex-grow: ${styleObj.flexGrow}`);
	}
	if (styleObj.flexShrink !== undefined) {
		cssProps.push(`flex-shrink: ${styleObj.flexShrink}`);
	}
	if (styleObj.flexBasis !== undefined) {
		cssProps.push(`flex-basis: ${formatDimension(styleObj.flexBasis)}`);
	}
	if (styleObj.flexWrap !== undefined) {
		cssProps.push(`flex-wrap: ${styleObj.flexWrap}`);
	}

	// Dimensions
	if (styleObj.width !== undefined) {
		cssProps.push(`width: ${formatDimension(styleObj.width)}`);
	}
	if (styleObj.height !== undefined) {
		cssProps.push(`height: ${formatDimension(styleObj.height)}`);
	}
	if (styleObj.minWidth !== undefined) {
		cssProps.push(`min-width: ${formatDimension(styleObj.minWidth)}`);
	}
	if (styleObj.maxWidth !== undefined) {
		cssProps.push(`max-width: ${formatDimension(styleObj.maxWidth)}`);
	}
	if (styleObj.minHeight !== undefined) {
		cssProps.push(`min-height: ${formatDimension(styleObj.minHeight)}`);
	}
	if (styleObj.maxHeight !== undefined) {
		cssProps.push(`max-height: ${formatDimension(styleObj.maxHeight)}`);
	}

	// Background & Colors
	const bg = styleObj.backgroundColor ?? styleObj.background;
	if (bg !== undefined && typeof bg === 'string') {
		cssProps.push(`background: ${bg}`);
	}
	if (styleObj.color !== undefined && typeof styleObj.color === 'string') {
		cssProps.push(`color: ${styleObj.color}`);
	}

	// Padding
	if (styleObj.padding !== undefined) {
		cssProps.push(`padding: ${formatDimension(styleObj.padding)}`);
	}
	if (styleObj.paddingVertical !== undefined) {
		cssProps.push(`padding-top: ${formatDimension(styleObj.paddingVertical)}`);
		cssProps.push(`padding-bottom: ${formatDimension(styleObj.paddingVertical)}`);
	}
	if (styleObj.paddingHorizontal !== undefined) {
		cssProps.push(`padding-left: ${formatDimension(styleObj.paddingHorizontal)}`);
		cssProps.push(`padding-right: ${formatDimension(styleObj.paddingHorizontal)}`);
	}
	if (styleObj.paddingTop !== undefined) {
		cssProps.push(`padding-top: ${formatDimension(styleObj.paddingTop)}`);
	}
	if (styleObj.paddingBottom !== undefined) {
		cssProps.push(`padding-bottom: ${formatDimension(styleObj.paddingBottom)}`);
	}
	if (styleObj.paddingLeft !== undefined) {
		cssProps.push(`padding-left: ${formatDimension(styleObj.paddingLeft)}`);
	}
	if (styleObj.paddingRight !== undefined) {
		cssProps.push(`padding-right: ${formatDimension(styleObj.paddingRight)}`);
	}

	// Margin
	if (styleObj.margin !== undefined) {
		cssProps.push(`margin: ${formatDimension(styleObj.margin)}`);
	}
	if (styleObj.marginVertical !== undefined) {
		cssProps.push(`margin-top: ${formatDimension(styleObj.marginVertical)}`);
		cssProps.push(`margin-bottom: ${formatDimension(styleObj.marginVertical)}`);
	}
	if (styleObj.marginHorizontal !== undefined) {
		cssProps.push(`margin-left: ${formatDimension(styleObj.marginHorizontal)}`);
		cssProps.push(`margin-right: ${formatDimension(styleObj.marginHorizontal)}`);
	}
	if (styleObj.marginTop !== undefined) {
		cssProps.push(`margin-top: ${formatDimension(styleObj.marginTop)}`);
	}
	if (styleObj.marginBottom !== undefined) {
		cssProps.push(`margin-bottom: ${formatDimension(styleObj.marginBottom)}`);
	}
	if (styleObj.marginLeft !== undefined) {
		cssProps.push(`margin-left: ${formatDimension(styleObj.marginLeft)}`);
	}
	if (styleObj.marginRight !== undefined) {
		cssProps.push(`margin-right: ${formatDimension(styleObj.marginRight)}`);
	}

	// Borders
	if (styleObj.borderRadius !== undefined) {
		cssProps.push(`border-radius: ${formatDimension(styleObj.borderRadius)}`);
	}
	if (styleObj.borderTopLeftRadius !== undefined) {
		cssProps.push(`border-top-left-radius: ${formatDimension(styleObj.borderTopLeftRadius)}`);
	}
	if (styleObj.borderTopRightRadius !== undefined) {
		cssProps.push(`border-top-right-radius: ${formatDimension(styleObj.borderTopRightRadius)}`);
	}
	if (styleObj.borderBottomLeftRadius !== undefined) {
		cssProps.push(`border-bottom-left-radius: ${formatDimension(styleObj.borderBottomLeftRadius)}`);
	}
	if (styleObj.borderBottomRightRadius !== undefined) {
		cssProps.push(`border-bottom-right-radius: ${formatDimension(styleObj.borderBottomRightRadius)}`);
	}
	if (styleObj.borderWidth !== undefined) {
		cssProps.push(`border-width: ${formatDimension(styleObj.borderWidth)}`);
		if (styleObj.borderStyle === undefined) {
			cssProps.push('border-style: solid');
		}
	}
	if (styleObj.borderColor !== undefined) {
		cssProps.push(`border-color: ${styleObj.borderColor}`);
	}
	if (styleObj.borderStyle !== undefined) {
		cssProps.push(`border-style: ${styleObj.borderStyle}`);
	}

	// Gap
	if (styleObj.gap !== undefined) {
		cssProps.push(`gap: ${formatDimension(styleObj.gap)}`);
	}
	if (styleObj.rowGap !== undefined) {
		cssProps.push(`row-gap: ${formatDimension(styleObj.rowGap)}`);
	}
	if (styleObj.columnGap !== undefined) {
		cssProps.push(`column-gap: ${formatDimension(styleObj.columnGap)}`);
	}

	// Typography & Visual
	if (styleObj.opacity !== undefined) {
		cssProps.push(`opacity: ${styleObj.opacity}`);
	}
	if (styleObj.overflow !== undefined) {
		cssProps.push(`overflow: ${styleObj.overflow}`);
	}
	if (styleObj.fontSize !== undefined) {
		cssProps.push(`font-size: ${formatDimension(styleObj.fontSize)}`);
	}
	if (styleObj.fontWeight !== undefined) {
		cssProps.push(`font-weight: ${styleObj.fontWeight}`);
	}
	if (styleObj.textAlign !== undefined) {
		cssProps.push(`text-align: ${styleObj.textAlign}`);
	}

	return cssProps.join('; ');
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function cleanJSXText(raw: string): string {
	if (/[\r\n]/.test(raw)) {
		const lines = raw.split(/\r\n|\n|\r/);
		const cleanedLines: string[] = [];
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed) {
				cleanedLines.push(trimmed);
			}
		}
		return cleanedLines.join(' ');
	}
	return raw.replace(/\s+/g, ' ');
}

function formatWireframeText(text: string, maxLen = 40): string {
	let str = text;
	if (str.length > maxLen) {
		str = str.slice(0, maxLen).trimEnd() + '...';
	}
	return escapeHtml(str);
}

function extractTextFromNode(node: babelTypes.JSXElement): string | null {
	const parts: string[] = [];

	for (const child of node.children) {
		if (t.isJSXText(child)) {
			const cleaned = cleanJSXText(child.value);
			if (cleaned) {
				parts.push(cleaned);
			}
		} else if (t.isJSXExpressionContainer(child)) {
			const expr = unwrapExpression(child.expression);
			if (t.isJSXEmptyExpression(expr)) {
				continue;
			}
			if (t.isStringLiteral(expr)) {
				parts.push(expr.value);
			} else if (t.isNumericLiteral(expr)) {
				parts.push(String(expr.value));
			} else if (
				t.isTemplateLiteral(expr) &&
				expr.expressions.length === 0 &&
				expr.quasis.length === 1
			) {
				parts.push(expr.quasis[0].value.raw);
			} else {
				// Dynamic or unresolvable expression -> fallback to generic placeholder
				return null;
			}
		} else if (t.isJSXElement(child)) {
			const childTag = getTagName(child);
			if (childTag === 'Text') {
				const nestedText = extractTextFromNode(child);
				if (nestedText === null) {
					return null;
				}
				parts.push(nestedText);
			} else {
				return null;
			}
		} else {
			return null;
		}
	}

	const combined = parts.join('').trim();
	return combined.length > 0 ? combined : null;
}

function isButtonTag(tagName: string): boolean {
	return (
		tagName === 'TouchableOpacity' ||
		tagName === 'Pressable' ||
		tagName === 'TouchableHighlight' ||
		tagName === 'TouchableWithoutFeedback' ||
		tagName === 'Button'
	);
}

function findFirstNestedText(node: babelTypes.JSXElement): string | null {
	for (const child of node.children) {
		if (t.isJSXElement(child)) {
			const tag = getTagName(child);
			if (tag === 'Text') {
				const text = extractTextFromNode(child);
				if (text) {
					return text;
				}
			}
			const nested = findFirstNestedText(child);
			if (nested) {
				return nested;
			}
		}
	}
	return null;
}

function extractButtonText(node: babelTypes.JSXElement, tagName: string): string | null {
	if (tagName === 'Button') {
		const titleAttr = node.openingElement.attributes.find(
			attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'title'
		) as babelTypes.JSXAttribute | undefined;
		if (titleAttr && titleAttr.value) {
			if (t.isStringLiteral(titleAttr.value)) {
				return titleAttr.value.value;
			}
			if (t.isJSXExpressionContainer(titleAttr.value)) {
				const expr = unwrapExpression(titleAttr.value.expression);
				if (expr && t.isStringLiteral(expr)) {
					return expr.value;
				}
			}
		}
	}
	return findFirstNestedText(node);
}

function extractPlaceholder(node: babelTypes.JSXElement): string | null {
	const placeholderAttr = node.openingElement.attributes.find(
		attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'placeholder'
	) as babelTypes.JSXAttribute | undefined;

	if (placeholderAttr && placeholderAttr.value) {
		if (t.isStringLiteral(placeholderAttr.value)) {
			return placeholderAttr.value.value;
		}
		if (t.isJSXExpressionContainer(placeholderAttr.value)) {
			const expr = unwrapExpression(placeholderAttr.value.expression);
			if (expr && t.isStringLiteral(expr)) {
				return expr.value;
			}
			if (
				expr &&
				t.isTemplateLiteral(expr) &&
				expr.expressions.length === 0 &&
				expr.quasis.length === 1
			) {
				return expr.quasis[0].value.raw;
			}
		}
	}
	return null;
}

function renderWireframeTag(
	tagName: string,
	childrenHtml: string,
	inlineStyle: string = '',
	extra?: {
		extractedText?: string | null;
		buttonText?: string | null;
		placeholder?: string | null;
		sourceLine?: number;
	}
): string {
	const lineAttr = extra?.sourceLine !== undefined ? ` data-line="${extra.sourceLine}"` : '';
	const styleAttr = inlineStyle ? ` style="${inlineStyle}"` : '';
	switch (tagName) {
		case 'View':
			return `<div class="wf-view"${lineAttr}${styleAttr}>${childrenHtml}</div>`;
		case 'Text': {
			const content = extra?.extractedText
				? formatWireframeText(extra.extractedText)
				: (childrenHtml || '<div class="wf-line"></div><div class="wf-line short"></div>');
			return `<div class="wf-text"${lineAttr}${styleAttr}>${content}</div>`;
		}
		case 'Image':
			return `<div class="wf-image"${lineAttr}${styleAttr}><div class="wf-circle"></div>${childrenHtml}</div>`;
		case 'TouchableOpacity':
		case 'Pressable':
		case 'TouchableHighlight':
		case 'TouchableWithoutFeedback':
		case 'Button': {
			const label = extra?.buttonText
				? formatWireframeText(extra.buttonText.toUpperCase())
				: 'BUTTON';
			return `<div class="wf-button"${lineAttr}${styleAttr}>${label}</div>`;
		}
		case 'TextInput': {
			const content = extra?.placeholder
				? `<span style="color:#777;font-size:9px;line-height:16px;padding-left:6px;display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${formatWireframeText(extra.placeholder, 30)}</span>`
				: childrenHtml;
			return `<div class="wf-input"${lineAttr}${styleAttr}>${content}</div>`;
		}
		case 'FlatList': {
			const listContent = childrenHtml || '<div class="wf-list-item"></div><div class="wf-list-item"></div><div class="wf-list-item"></div>';
			return `<div class="wf-view"${lineAttr}${styleAttr}>${listContent}</div>`;
		}
		case 'ScrollView': {
			const scrollContent = childrenHtml || '<div class="wf-list-item"></div><div class="wf-list-item"></div><div class="wf-list-item"></div>';
			return childrenHtml
				? `<div class="wf-view"${lineAttr}${styleAttr}>${childrenHtml}</div>`
				: (styleAttr || lineAttr ? `<div class="wf-view"${lineAttr}${styleAttr}>${scrollContent}</div>` : scrollContent);
		}
		default:
			// Unknown/unsupported elements should be skipped, but their children should still be walked
			return childrenHtml;
	}
}

function extractJSXFromExpression(node: babelTypes.Node | null | undefined): babelTypes.Node | null {
	if (!node) {
		return null;
	}
	if (t.isJSXElement(node) || t.isJSXFragment(node)) {
		return node;
	}
	if (t.isParenthesizedExpression(node)) {
		return extractJSXFromExpression(node.expression);
	}
	if (t.isConditionalExpression(node)) {
		return extractJSXFromExpression(node.alternate) || extractJSXFromExpression(node.consequent);
	}
	if (t.isLogicalExpression(node)) {
		return extractJSXFromExpression(node.right) || extractJSXFromExpression(node.left);
	}
	return null;
}

function wrapInFile(node: babelTypes.Node): babelTypes.File {
	const stmt = t.isStatement(node) ? node : t.expressionStatement(node as babelTypes.Expression);
	return t.file(t.program([stmt]));
}

function getJSXFromFunction(fnNode: babelTypes.Node): babelTypes.Node | null {
	if (t.isArrowFunctionExpression(fnNode) && !t.isBlockStatement(fnNode.body)) {
		return extractJSXFromExpression(fnNode.body);
	}

	let returnedJsx: babelTypes.Node | null = null;
	traverse(wrapInFile(fnNode), {
		Function(p) {
			if (p.node !== fnNode) {
				p.skip();
			}
		},
		Class(p) {
			p.skip();
		},
		ReturnStatement(rPath) {
			const jsx = extractJSXFromExpression(rPath.node.argument);
			if (jsx) {
				returnedJsx = jsx;
			}
		}
	});

	return returnedJsx;
}

function buildWireframeFromJSX(
	rootNode: babelTypes.Node | null,
	styleSheets: Map<string, Map<string, Record<string, any>>>,
	allStylesByKey: Map<string, Record<string, any>>,
	fileConstants: Map<string, any>
): string {
	if (!rootNode) {
		return '<div class="empty">Open a React Native file</div>';
	}

	interface StackItem {
		tag: string;
		children: string[];
		inlineStyle: string;
		sourceLine?: number;
		extractedText?: string | null;
		buttonText?: string | null;
		placeholder?: string | null;
	}

	const stack: StackItem[] = [{ tag: '__ROOT__', children: [], inlineStyle: '' }];

	traverse(wrapInFile(rootNode), {
		JSXOpeningElement(path) {
			path.skip();
		},
		JSXElement: {
			enter(path) {
				const tag = getTagName(path.node);
				const sourceLine = path.node.loc?.start.line;
				let inlineStyle = '';
				const styleAttr = path.node.openingElement.attributes.find(
					attr => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'style'
				) as babelTypes.JSXAttribute | undefined;

				if (styleAttr && styleAttr.value) {
					let styleObj: Record<string, any> | null = null;
					if (t.isJSXExpressionContainer(styleAttr.value)) {
						const expr = styleAttr.value.expression;
						if (!t.isJSXEmptyExpression(expr)) {
							styleObj = resolveStyleExpression(expr, styleSheets, allStylesByKey, fileConstants);
						}
					} else if (t.isStringLiteral(styleAttr.value)) {
						inlineStyle = styleAttr.value.value;
					}

					if (styleObj) {
						inlineStyle = convertStyleToCSS(styleObj);
					}
				}

				let extractedText: string | null = null;
				let buttonText: string | null = null;
				let placeholder: string | null = null;

				if (tag === 'Text') {
					extractedText = extractTextFromNode(path.node);
				} else if (isButtonTag(tag)) {
					buttonText = extractButtonText(path.node, tag);
				} else if (tag === 'TextInput') {
					placeholder = extractPlaceholder(path.node);
				}

				stack.push({
					tag,
					children: [],
					inlineStyle,
					sourceLine,
					extractedText,
					buttonText,
					placeholder
				});
			},
			exit() {
				const item = stack.pop();
				if (item) {
					const childrenHtml = item.children.join('');
					const html = renderWireframeTag(item.tag, childrenHtml, item.inlineStyle, {
						extractedText: item.extractedText,
						buttonText: item.buttonText,
						placeholder: item.placeholder,
						sourceLine: item.sourceLine
					});
					if (html) {
						stack[stack.length - 1].children.push(html);
					}
				}
			}
		},
		JSXFragment: {
			enter() {
				stack.push({ tag: '__FRAGMENT__', children: [], inlineStyle: '' });
			},
			exit() {
				const item = stack.pop();
				if (item) {
					const html = item.children.join('');
					if (html) {
						stack[stack.length - 1].children.push(html);
					}
				}
			}
		}
	});

	const wireframe = stack[0].children.join('');
	return wireframe || '<div class="empty">Open a React Native file</div>';
}

export function parseReactNativeComponent(
	code: string,
	targetExportName?: string
): { name: string; wireframe: string } {
	const ast = parse(code, {
		sourceType: 'module',
		plugins: ['jsx', 'typescript']
	});

	let defaultExportNode: babelTypes.Node | null | undefined;
	const namedExports = new Map<string, { name: string; fnNode?: babelTypes.Node }>();
	const allDeclarations = new Map<string, { name: string; fnNode: babelTypes.Node }>();

	const fileConstants = new Map<string, any>();
	const rawStyleSheets: Array<{ varName: string; objExpr: babelTypes.ObjectExpression }> = [];

	traverse(ast, {
		FunctionDeclaration(path) {
			if (path.node.id) {
				allDeclarations.set(path.node.id.name, {
					name: path.node.id.name,
					fnNode: path.node
				});
			}
		},
		VariableDeclaration(path) {
			for (const d of path.node.declarations) {
				if (t.isIdentifier(d.id)) {
					const varName = d.id.name;
					let fn = d.init;
					if (fn && t.isCallExpression(fn)) {
						const arg = fn.arguments[0];
						if (arg && (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg))) {
							fn = arg;
						}
					}
					if (fn && (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn))) {
						allDeclarations.set(varName, {
							name: varName,
							fnNode: fn
						});
					}

					// Collect top-level constants and plain style objects
					if (d.init) {
						const unwrapped = unwrapExpression(d.init);
						if (unwrapped) {
							if (
								t.isNumericLiteral(unwrapped) ||
								t.isStringLiteral(unwrapped) ||
								t.isBooleanLiteral(unwrapped)
							) {
								fileConstants.set(varName, unwrapped.value);
							} else if (t.isUnaryExpression(unwrapped)) {
								const arg = unwrapExpression(unwrapped.argument);
								if (unwrapped.operator === '-' && arg && t.isNumericLiteral(arg)) {
									fileConstants.set(varName, -arg.value);
								}
							} else if (t.isObjectExpression(unwrapped)) {
								if (
									varName === 'styles' ||
									varName === 'style' ||
									varName.endsWith('Styles') ||
									varName.endsWith('Style')
								) {
									rawStyleSheets.push({ varName, objExpr: unwrapped });
								}
							}
						}
					}
				}
			}
		},
		CallExpression(path) {
			if (isStyleSheetCreate(path.node)) {
				let varName = 'styles';
				const parent = path.parentPath?.node;
				if (parent && t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
					varName = parent.id.name;
				}
				const arg = path.node.arguments[0];
				if (arg && t.isObjectExpression(arg)) {
					rawStyleSheets.push({ varName, objExpr: arg });
				}
			}
		},
		ClassDeclaration(path) {
			if (path.node.id) {
				const renderMethod = path.node.body.body.find(
					member => t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === 'render'
				);
				if (renderMethod) {
					allDeclarations.set(path.node.id.name, {
						name: path.node.id.name,
						fnNode: renderMethod
					});
				}
			}
		},
		ExportDefaultDeclaration(path) {
			defaultExportNode = path.node.declaration;
			const unwrapped = unwrapExpression(path.node.declaration);
			if (unwrapped && t.isCallExpression(unwrapped) && isStyleSheetCreate(unwrapped)) {
				const arg = unwrapExpression(unwrapped.arguments[0]);
				if (arg && t.isObjectExpression(arg)) {
					rawStyleSheets.push({ varName: 'styles', objExpr: arg });
				}
			}
		},
		ExportNamedDeclaration(path) {
			if (path.node.declaration) {
				const decl = path.node.declaration;
				if (t.isFunctionDeclaration(decl) && decl.id) {
					namedExports.set(decl.id.name, {
						name: decl.id.name,
						fnNode: decl
					});
				} else if (t.isVariableDeclaration(decl)) {
					for (const d of decl.declarations) {
						if (t.isIdentifier(d.id)) {
							let fn = d.init;
							if (fn && t.isCallExpression(fn)) {
								const arg = fn.arguments[0];
								if (arg && (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg))) {
									fn = arg;
								}
							}
							namedExports.set(d.id.name, {
								name: d.id.name,
								fnNode: fn || undefined
							});
						}
					}
				} else if (t.isClassDeclaration(decl) && decl.id) {
					const renderMethod = decl.body.body.find(
						member => t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === 'render'
					);
					if (renderMethod) {
						namedExports.set(decl.id.name, {
							name: decl.id.name,
							fnNode: renderMethod
						});
					}
				}
			}
			if (path.node.specifiers) {
				for (const spec of path.node.specifiers) {
					if (t.isExportSpecifier(spec) && t.isIdentifier(spec.local)) {
						const exportedName = t.isIdentifier(spec.exported) ? spec.exported.name : spec.local.name;
						namedExports.set(spec.local.name, { name: exportedName });
					}
				}
			}
		}
	});

	// Populate stylesheets
	const styleSheets = new Map<string, Map<string, Record<string, any>>>();
	const allStylesByKey = new Map<string, Record<string, any>>();

	for (const { varName, objExpr } of rawStyleSheets) {
		const entries = extractStyleSheetEntries(objExpr, fileConstants);
		if (!styleSheets.has(varName)) {
			styleSheets.set(varName, new Map());
		}
		const sheet = styleSheets.get(varName)!;
		for (const [k, v] of entries) {
			sheet.set(k, v);
			allStylesByKey.set(k, v);
		}
	}

	let componentName = 'Component';
	let topLevelJSX: babelTypes.Node | null = null;

	if (targetExportName) {
		const named = namedExports.get(targetExportName);
		if (named) {
			const fn = named.fnNode || allDeclarations.get(targetExportName)?.fnNode;
			if (fn) {
				const jsx = getJSXFromFunction(fn);
				if (jsx) {
					componentName = named.name || targetExportName;
					topLevelJSX = jsx;
				}
			}
		}

		if (!topLevelJSX) {
			const decl = allDeclarations.get(targetExportName);
			if (decl) {
				const jsx = getJSXFromFunction(decl.fnNode);
				if (jsx) {
					componentName = decl.name || targetExportName;
					topLevelJSX = jsx;
				}
			}
		}

		if (!topLevelJSX && defaultExportNode) {
			const node = defaultExportNode;
			const defName = t.isFunctionDeclaration(node) && node.id
				? node.id.name
				: t.isIdentifier(node)
				? node.name
				: null;
			if (defName === targetExportName) {
				const jsx = getJSXFromFunction(node);
				if (jsx) {
					componentName = targetExportName;
					topLevelJSX = jsx;
				}
			}
		}
	}

	if (!topLevelJSX && defaultExportNode) {
		const node = defaultExportNode;
		if (t.isFunctionDeclaration(node)) {
			componentName = node.id ? node.id.name : 'Component';
			topLevelJSX = getJSXFromFunction(node);
		} else if (t.isArrowFunctionExpression(node)) {
			componentName = 'Component';
			topLevelJSX = getJSXFromFunction(node);
		} else if (t.isFunctionExpression(node)) {
			componentName = node.id ? node.id.name : 'Component';
			topLevelJSX = getJSXFromFunction(node);
		} else if (t.isClassDeclaration(node)) {
			componentName = node.id ? node.id.name : 'Component';
			const renderMethod = node.body.body.find(
				(member: babelTypes.ClassBody['body'][number]) =>
					t.isClassMethod(member) && t.isIdentifier(member.key) && member.key.name === 'render'
			);
			if (renderMethod) {
				topLevelJSX = getJSXFromFunction(renderMethod);
			}
		} else if (t.isIdentifier(node)) {
			componentName = node.name;
			const decl = allDeclarations.get(node.name);
			if (decl) {
				topLevelJSX = getJSXFromFunction(decl.fnNode);
			}
		} else if (t.isCallExpression(node)) {
			const arg = node.arguments[0];
			if (arg && t.isIdentifier(arg)) {
				componentName = arg.name;
				const decl = allDeclarations.get(arg.name);
				if (decl) {
					topLevelJSX = getJSXFromFunction(decl.fnNode);
				}
			} else if (arg && t.isArrowFunctionExpression(arg)) {
				componentName = 'Component';
				topLevelJSX = getJSXFromFunction(arg);
			} else if (arg && t.isFunctionExpression(arg)) {
				componentName = arg.id ? arg.id.name : 'Component';
				topLevelJSX = getJSXFromFunction(arg);
			}
		}
	}

	if (!topLevelJSX) {
		for (const [key, entry] of namedExports) {
			const fn = entry.fnNode || allDeclarations.get(key)?.fnNode;
			if (fn) {
				const jsx = getJSXFromFunction(fn);
				if (jsx) {
					componentName = entry.name;
					topLevelJSX = jsx;
					break;
				}
			}
		}
	}

	if (!topLevelJSX) {
		for (const [, entry] of allDeclarations) {
			const jsx = getJSXFromFunction(entry.fnNode);
			if (jsx) {
				componentName = entry.name;
				topLevelJSX = jsx;
				break;
			}
		}
	}

	const wireframe = buildWireframeFromJSX(
		topLevelJSX,
		styleSheets,
		allStylesByKey,
		fileConstants
	);
	return { name: componentName, wireframe };
}

/* -------------------------------------------------------------------------
   React Navigation support
------------------------------------------------------------------------- */

export type NavigatorType = 'bottom-tabs' | 'drawer' | 'stack';

export interface NavigatorDetectionResult {
	type: NavigatorType;
	typeName: string;
}

export function detectNavigator(code: string, ast?: babelTypes.File): NavigatorDetectionResult | null {
	const hasBottomTabs =
		code.includes('createBottomTabNavigator') || code.includes('@react-navigation/bottom-tabs');
	const hasDrawer =
		code.includes('createDrawerNavigator') || code.includes('@react-navigation/drawer');
	const hasStack =
		code.includes('createNativeStackNavigator') ||
		code.includes('createStackNavigator') ||
		code.includes('@react-navigation/native-stack') ||
		code.includes('@react-navigation/stack');

	if (!hasBottomTabs && !hasDrawer && !hasStack) {
		return null;
	}

	let parsedAst = ast;
	if (!parsedAst) {
		try {
			parsedAst = parse(code, {
				sourceType: 'module',
				plugins: ['jsx', 'typescript']
			});
		} catch {
			return null;
		}
	}

	let detectedType: NavigatorType | null = null;
	let detectedTypeName = '';

	traverse(parsedAst, {
		ImportDeclaration(p) {
			const source = p.node.source.value;
			if (source === '@react-navigation/bottom-tabs') {
				detectedType = 'bottom-tabs';
				detectedTypeName = 'Bottom Tab Navigator';
			} else if (source === '@react-navigation/drawer') {
				if (!detectedType) {
					detectedType = 'drawer';
					detectedTypeName = 'Drawer Navigator';
				}
			} else if (source === '@react-navigation/native-stack' || source === '@react-navigation/stack') {
				if (!detectedType) {
					detectedType = 'stack';
					detectedTypeName = 'Stack Navigator';
				}
			}

			for (const spec of p.node.specifiers) {
				if (t.isImportSpecifier(spec)) {
					const importedName = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
					if (importedName === 'createBottomTabNavigator') {
						detectedType = 'bottom-tabs';
						detectedTypeName = 'Bottom Tab Navigator';
					} else if (importedName === 'createDrawerNavigator' && !detectedType) {
						detectedType = 'drawer';
						detectedTypeName = 'Drawer Navigator';
					} else if (
						(importedName === 'createNativeStackNavigator' || importedName === 'createStackNavigator') &&
						!detectedType
					) {
						detectedType = 'stack';
						detectedTypeName = 'Stack Navigator';
					}
				}
			}
		},
		CallExpression(p) {
			const callee = unwrapExpression(p.node.callee);
			if (callee && t.isIdentifier(callee)) {
				if (callee.name === 'createBottomTabNavigator') {
					detectedType = 'bottom-tabs';
					detectedTypeName = 'Bottom Tab Navigator';
				} else if (callee.name === 'createDrawerNavigator' && !detectedType) {
					detectedType = 'drawer';
					detectedTypeName = 'Drawer Navigator';
				} else if (
					(callee.name === 'createNativeStackNavigator' || callee.name === 'createStackNavigator') &&
					!detectedType
				) {
					detectedType = 'stack';
					detectedTypeName = 'Stack Navigator';
				}
			}
		}
	});

	if (detectedType) {
		return { type: detectedType, typeName: detectedTypeName };
	}
	return null;
}

export interface ExtractedScreen {
	name: string;
	componentIdentifier: string | null;
	sourceLine?: number;
}

export function extractNavigatorScreens(
	code: string,
	ast?: babelTypes.File
): { screens: ExtractedScreen[]; signature: string } {
	let parsedAst = ast;
	if (!parsedAst) {
		try {
			parsedAst = parse(code, {
				sourceType: 'module',
				plugins: ['jsx', 'typescript']
			});
		} catch {
			return { screens: [], signature: '' };
		}
	}

	// 1. Locate the first navigator JSX element if one exists (outermost / first navigator)
	let navigatorSubtree: babelTypes.Node | null = null;
	traverse(parsedAst, {
		JSXElement(p) {
			const tagName = getFullTagName(p.node);
			if (tagName.endsWith('.Navigator') || tagName === 'Navigator') {
				if (!navigatorSubtree) {
					navigatorSubtree = p.node;
					p.stop();
				}
			}
		}
	});

	const rootToWalk = navigatorSubtree || parsedAst;
	const screens: ExtractedScreen[] = [];

	traverse(wrapInFile(rootToWalk), {
		JSXElement(p) {
			const tagName = getFullTagName(p.node);
			if (tagName.endsWith('.Screen') || tagName === 'Screen') {
				let screenName: string | null = null;
				let componentIdentifier: string | null = null;
				const sourceLine = p.node.loc?.start.line;

				for (const attr of p.node.openingElement.attributes) {
					if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
						if (attr.name.name === 'name' && attr.value) {
							if (t.isStringLiteral(attr.value)) {
								screenName = attr.value.value;
							} else if (t.isJSXExpressionContainer(attr.value)) {
								const expr = attr.value.expression;
								if (t.isStringLiteral(expr)) {
									screenName = expr.value;
								} else if (t.isTemplateLiteral(expr) && expr.quasis.length === 1) {
									screenName = expr.quasis[0].value.raw;
								}
							}
						} else if (attr.name.name === 'component' && attr.value) {
							if (t.isJSXExpressionContainer(attr.value)) {
								const expr = attr.value.expression;
								if (t.isIdentifier(expr)) {
									componentIdentifier = expr.name;
								} else if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
									componentIdentifier = expr.property.name;
								} else if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
									componentIdentifier = extractComponentFromFunction(expr);
								}
							}
						} else if (attr.name.name === 'getComponent' && attr.value) {
							if (t.isJSXExpressionContainer(attr.value)) {
								const expr = attr.value.expression;
								if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
									componentIdentifier = extractComponentFromFunction(expr);
								}
							}
						}
					}
				}

				// If component was not on props, check children
				if (!componentIdentifier && p.node.children.length > 0) {
					for (const child of p.node.children) {
						if (t.isJSXElement(child)) {
							componentIdentifier = getTagName(child);
							break;
						} else if (t.isJSXExpressionContainer(child)) {
							const expr = child.expression;
							if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
								const id = extractComponentFromFunction(expr);
								if (id) {
									componentIdentifier = id;
									break;
								}
							}
						}
					}
				}

				if (screenName) {
					screens.push({
						name: screenName,
						componentIdentifier,
						sourceLine
					});
				}
			}
		}
	});

	const signature = screens.map(s => `${s.name}:${s.componentIdentifier || ''}`).join('|');
	return { screens, signature };
}

function extractComponentFromFunction(
	fn: babelTypes.ArrowFunctionExpression | babelTypes.FunctionExpression
): string | null {
	if (t.isArrowFunctionExpression(fn) && !t.isBlockStatement(fn.body)) {
		if (t.isJSXElement(fn.body)) {
			return getTagName(fn.body);
		}
		if (t.isIdentifier(fn.body)) {
			return fn.body.name;
		}
	}
	if (t.isBlockStatement(fn.body)) {
		for (const stmt of fn.body.body) {
			if (t.isReturnStatement(stmt) && stmt.argument) {
				if (t.isJSXElement(stmt.argument)) {
					return getTagName(stmt.argument);
				}
				if (t.isIdentifier(stmt.argument)) {
					return stmt.argument.name;
				}
			}
		}
	}
	return null;
}

function tryFileExtensions(basePath: string): string | null {
	try {
		if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
			return basePath;
		}
	} catch {
		// ignore
	}

	const extensions = ['.tsx', '.jsx', '.ts', '.js'];

	for (const ext of extensions) {
		const file = basePath + ext;
		try {
			if (fs.existsSync(file) && fs.statSync(file).isFile()) {
				return file;
			}
		} catch {
			// ignore
		}
	}

	for (const ext of extensions) {
		const indexFile = path.join(basePath, `index${ext}`);
		try {
			if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
				return indexFile;
			}
		} catch {
			// ignore
		}
	}

	return null;
}

function resolveRelativeImport(
	importSource: string,
	fromFilePath: string
): string | null {
	if (!fromFilePath) {
		return null;
	}

	const dir = path.dirname(fromFilePath);
	let candidateBase: string | null = null;

	if (importSource.startsWith('.')) {
		candidateBase = path.resolve(dir, importSource);
	} else if (importSource.startsWith('@/') || importSource.startsWith('~/')) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspaceFolder) {
			const subPath = importSource.slice(2);
			const srcCandidate = path.resolve(workspaceFolder, 'src', subPath);
			const rootCandidate = path.resolve(workspaceFolder, subPath);
			const foundSrc = tryFileExtensions(srcCandidate);
			if (foundSrc) {
				return foundSrc;
			}
			const foundRoot = tryFileExtensions(rootCandidate);
			if (foundRoot) {
				return foundRoot;
			}
		}
		return null;
	} else {
		return null;
	}

	if (!candidateBase) {
		return null;
	}

	return tryFileExtensions(candidateBase);
}

export function extractImportMap(
	code: string,
	ast?: babelTypes.File
): Map<string, { source: string; isDefault: boolean; importedName: string }> {
	let parsedAst = ast;
	if (!parsedAst) {
		try {
			parsedAst = parse(code, {
				sourceType: 'module',
				plugins: ['jsx', 'typescript']
			});
		} catch {
			return new Map();
		}
	}

	const map = new Map<string, { source: string; isDefault: boolean; importedName: string }>();

	traverse(parsedAst, {
		ImportDeclaration(p) {
			const source = p.node.source.value;
			for (const spec of p.node.specifiers) {
				if (t.isImportDefaultSpecifier(spec)) {
					map.set(spec.local.name, {
						source,
						isDefault: true,
						importedName: 'default'
					});
				} else if (t.isImportSpecifier(spec)) {
					const importedName = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
					map.set(spec.local.name, {
						source,
						isDefault: false,
						importedName
					});
				}
			}
		}
	});

	return map;
}

export interface ResolvedScreenComponent {
	filePath: string | null;
	targetExportName?: string;
	isLocal: boolean;
}

export function resolveComponentSource(
	componentIdentifier: string | null,
	navigatorCode: string,
	navigatorFilePath?: string,
	importMap?: Map<string, { source: string; isDefault: boolean; importedName: string }>
): ResolvedScreenComponent {
	if (!componentIdentifier) {
		return { filePath: null, isLocal: false };
	}

	const imports = importMap || extractImportMap(navigatorCode);
	const importInfo = imports.get(componentIdentifier);

	if (importInfo) {
		if (navigatorFilePath) {
			const resolvedPath = resolveRelativeImport(importInfo.source, navigatorFilePath);
			if (resolvedPath) {
				return {
					filePath: resolvedPath,
					targetExportName: importInfo.isDefault ? undefined : importInfo.importedName,
					isLocal: false
				};
			}
		}
		// Unresolvable import
		return { filePath: null, targetExportName: importInfo.importedName, isLocal: false };
	}

	// Check if declared in the same file
	if (navigatorFilePath) {
		return {
			filePath: navigatorFilePath,
			targetExportName: componentIdentifier,
			isLocal: true
		};
	}

	return { filePath: null, isLocal: false };
}

export interface ScreenPreviewData {
	name: string;
	componentName: string;
	wireframe: string;
	filePath?: string;
}

export interface NavigatorState {
	navigatorType: NavigatorType;
	navigatorTypeName: string;
	navigatorFile: string;
	screens: ScreenPreviewData[];
}

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
			provider.handleDocumentChange(event.document);
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && isRNFile(editor.document)) {
				provider.updatePreview(editor.document.getText(), editor.document.uri);
			}
		})
	);

	if (vscode.window.activeTextEditor && isRNFile(vscode.window.activeTextEditor.document)) {
		provider.updatePreview(
			vscode.window.activeTextEditor.document.getText(),
			vscode.window.activeTextEditor.document.uri
		);
	}
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
	private _lastDocumentUri?: vscode.Uri;
	private _currentScreenUri?: vscode.Uri;
	private _cachedCode?: string;
	private _cachedResult?: { name: string; wireframe: string };
	private _lastSuccessfulName: string = 'Component';
	private _lastSuccessfulWireframe: string = '<div class="empty">Open a React Native file</div>';

	// React Navigation multi-screen tracking
	private _isNavigator: boolean = false;
	private _currentNavigatorState?: NavigatorState;
	private _cachedScreensSignature?: string;
	private _selectedScreenIndex: number = 0;
	private _trackedScreenFiles: Set<string> = new Set<string>();
	private _screenFileCache: Map<string, { code: string; result: { name: string; wireframe: string } }> = new Map();

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
				if (this._isNavigator && this._currentNavigatorState && this._lastDocumentUri) {
					const navDetection: NavigatorDetectionResult = {
						type: this._currentNavigatorState.navigatorType,
						typeName: this._currentNavigatorState.navigatorTypeName
					};
					this.updateNavigatorPreview(this._lastCode, this._lastDocumentUri.fsPath, navDetection);
				} else {
					this._view!.webview.html = this.getHTML(
						this.extractElements(this._lastCode),
						this.extractName(this._lastCode),
						[],
						0
					);
				}
			} else if (message.command === 'selectScreen') {
				if (typeof message.index === 'number') {
					this._selectedScreenIndex = message.index;
				}
				if (message.filePath) {
					this._currentScreenUri = vscode.Uri.file(message.filePath);
				}
			} else if (message.command === 'revealLine') {
				this.revealLine(message.line, message.filePath);
			}
		});
	}

	updatePreview(code: string, uri?: vscode.Uri) {
		if (uri) {
			this._lastDocumentUri = uri;
		}
		if (!this._view) { return; }
		this._lastCode = code;

		const currentFilePath = uri?.fsPath;

		// 1. Check if the file is a React Navigation navigator
		const navDetection = detectNavigator(code);

		if (navDetection && currentFilePath) {
			this._isNavigator = true;
			this.updateNavigatorPreview(code, currentFilePath, navDetection);
			return;
		}

		// 2. Normal single-file component preview
		this._isNavigator = false;
		this._currentNavigatorState = undefined;
		this._currentScreenUri = uri;

		const name = this.extractName(code);
		const wireframe = this.extractElements(code);
		this._view.webview.html = this.getHTML(wireframe, name, [], 0);
	}

	private updateNavigatorPreview(
		code: string,
		navigatorFilePath: string,
		navDetection: NavigatorDetectionResult
	) {
		const { screens: extractedScreens, signature } = extractNavigatorScreens(code);

		if (extractedScreens.length === 0) {
			this._isNavigator = false;
			this._currentNavigatorState = undefined;
			this._currentScreenUri = this._lastDocumentUri;
			const name = this.extractName(code);
			const wireframe = this.extractElements(code);
			this._view!.webview.html = this.getHTML(wireframe, name, [], 0);
			return;
		}

		// Extract import map from the navigator file
		const importMap = extractImportMap(code);

		// Resolve and build screen preview data
		const resolvedScreens: ScreenPreviewData[] = [];
		const newTrackedFiles = new Set<string>();

		for (const screen of extractedScreens) {
			const resolved = resolveComponentSource(
				screen.componentIdentifier,
				code,
				navigatorFilePath,
				importMap
			);

			if (resolved.filePath) {
				newTrackedFiles.add(resolved.filePath);
				const screenParsed = this.getOrParseScreenFile(
					resolved.filePath,
					resolved.targetExportName,
					resolved.filePath === navigatorFilePath ? code : undefined
				);
				resolvedScreens.push({
					name: screen.name,
					componentName: screenParsed.name || screen.componentIdentifier || screen.name,
					wireframe: screenParsed.wireframe,
					filePath: resolved.filePath
				});
			} else {
				// Unresolvable screen file
				resolvedScreens.push({
					name: screen.name,
					componentName: screen.componentIdentifier || screen.name,
					wireframe: '<div class="empty" style="margin-top:40px;color:#888;">Could not resolve source</div>',
					filePath: undefined
				});
			}
		}

		this._trackedScreenFiles = newTrackedFiles;
		this._cachedScreensSignature = signature;

		// Determine default selected screen:
		// "Default to the screen matching the currently active file if applicable, otherwise the first screen."
		const activeFilePath = vscode.window.activeTextEditor?.document.uri.fsPath;
		let selectedIndex = 0;

		if (activeFilePath && activeFilePath !== navigatorFilePath) {
			const matchingIdx = resolvedScreens.findIndex(s => s.filePath === activeFilePath);
			if (matchingIdx >= 0) {
				selectedIndex = matchingIdx;
			} else if (this._selectedScreenIndex < resolvedScreens.length) {
				selectedIndex = this._selectedScreenIndex;
			}
		} else if (this._selectedScreenIndex < resolvedScreens.length) {
			selectedIndex = this._selectedScreenIndex;
		}

		this._selectedScreenIndex = selectedIndex;
		const currentScreen = resolvedScreens[selectedIndex] || resolvedScreens[0];

		if (currentScreen?.filePath) {
			this._currentScreenUri = vscode.Uri.file(currentScreen.filePath);
		} else {
			this._currentScreenUri = this._lastDocumentUri;
		}

		this._currentNavigatorState = {
			navigatorType: navDetection.type,
			navigatorTypeName: navDetection.typeName,
			navigatorFile: navigatorFilePath,
			screens: resolvedScreens
		};

		const displayWireframe = currentScreen
			? currentScreen.wireframe
			: '<div class="empty">No screens available</div>';
		const displayName = currentScreen
			? (currentScreen.componentName || currentScreen.name)
			: 'Navigator';

		this._view!.webview.html = this.getHTML(
			displayWireframe,
			displayName,
			resolvedScreens,
			selectedIndex,
			navDetection.typeName
		);
	}

	private getOrParseScreenFile(
		filePath: string,
		targetExportName?: string,
		inMemoryCode?: string
	): { name: string; wireframe: string } {
		const cacheKey = `${filePath}::${targetExportName || ''}`;

		let fileCode = inMemoryCode;
		if (fileCode === undefined) {
			const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === filePath);
			if (openDoc) {
				fileCode = openDoc.getText();
			} else {
				try {
					if (fs.existsSync(filePath)) {
						fileCode = fs.readFileSync(filePath, 'utf8');
					}
				} catch {
					fileCode = '';
				}
			}
		}

		if (!fileCode) {
			return {
				name: targetExportName || 'Screen',
				wireframe: '<div class="empty" style="margin-top:40px;color:#888;">Could not resolve source</div>'
			};
		}

		const cached = this._screenFileCache.get(cacheKey);
		if (cached && cached.code === fileCode) {
			return cached.result;
		}

		try {
			const parsed = parseReactNativeComponent(fileCode, targetExportName);
			this._screenFileCache.set(cacheKey, { code: fileCode, result: parsed });
			return parsed;
		} catch {
			return {
				name: targetExportName || 'Screen',
				wireframe: '<div class="empty" style="margin-top:40px;color:#888;">Could not resolve source</div>'
			};
		}
	}

	handleDocumentChange(document: vscode.TextDocument) {
		const changedPath = document.uri.fsPath;

		// 1. If this document is one of our tracked screen files, invalidate its cache
		if (this._trackedScreenFiles.has(changedPath)) {
			for (const key of Array.from(this._screenFileCache.keys())) {
				if (key.startsWith(`${changedPath}::`)) {
					this._screenFileCache.delete(key);
				}
			}

			// If we are currently previewing a navigator and the changed screen is the selected one, update preview
			if (this._isNavigator && this._currentNavigatorState && this._view) {
				const currentScreen = this._currentNavigatorState.screens[this._selectedScreenIndex];
				if (currentScreen && currentScreen.filePath === changedPath) {
					if (this._lastDocumentUri && this._lastCode) {
						const navDetection: NavigatorDetectionResult = {
							type: this._currentNavigatorState.navigatorType,
							typeName: this._currentNavigatorState.navigatorTypeName
						};
						this.updateNavigatorPreview(this._lastCode, this._lastDocumentUri.fsPath, navDetection);
					}
				}
			}
		}

		// 2. If the changed document is the currently active file, update it
		if (isRNFile(document)) {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.uri.fsPath === changedPath) {
				this.updatePreview(document.getText(), document.uri);
			}
		}
	}

	private async revealLine(line: number, filePath?: string) {
		if (typeof line !== 'number' || isNaN(line)) {
			return;
		}
		let targetUri: vscode.Uri | undefined;
		if (filePath) {
			try {
				targetUri = vscode.Uri.file(filePath);
			} catch {
				// ignore
			}
		}
		if (!targetUri) {
			targetUri = this._currentScreenUri || this._lastDocumentUri;
		}
		if (!targetUri) {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && isRNFile(activeEditor.document)) {
				targetUri = activeEditor.document.uri;
				this._lastDocumentUri = targetUri;
			}
		}

		if (!targetUri) {
			vscode.window.setStatusBarMessage('Source file not open.', 3000);
			return;
		}

		try {
			const lineIndex = Math.max(0, line - 1);
			const pos = new vscode.Position(lineIndex, 0);
			const range = new vscode.Range(pos, pos);
			const doc = await vscode.workspace.openTextDocument(targetUri);
			const editor = await vscode.window.showTextDocument(doc, {
				selection: range,
				preserveFocus: false
			});
			editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
		} catch {
			vscode.window.setStatusBarMessage('Source file not open.', 3000);
		}
	}

	private extractName(code: string): string {
		return this.parseComponent(code).name;
	}

	private extractElements(code: string): string {
		return this.parseComponent(code).wireframe;
	}

	private parseComponent(code: string): { name: string; wireframe: string } {
		if (this._cachedCode === code && this._cachedResult) {
			return this._cachedResult;
		}

		try {
			const result = this.doAstParse(code);
			this._lastSuccessfulName = result.name;
			this._lastSuccessfulWireframe = result.wireframe;
			this._cachedCode = code;
			this._cachedResult = result;
			return result;
		} catch {
			// If parsing fails (e.g. invalid/incomplete code mid-typing), fail gracefully
			const fallback = {
				name: this._lastSuccessfulName,
				wireframe: this._lastSuccessfulWireframe
			};
			this._cachedCode = code;
			this._cachedResult = fallback;
			return fallback;
		}
	}

	private doAstParse(code: string): { name: string; wireframe: string } {
		return parseReactNativeComponent(code);
	}

	private getHTML(
		wireframe: string,
		name: string,
		screens: ScreenPreviewData[] = [],
		selectedIndex: number = 0,
		navigatorTypeName?: string
	): string {
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
    font-size:11px;
    cursor:pointer;
    text-align:center;
    transition: all 0.15s;
  }
  .btn:hover { background:#383838; }
  .btn.active {
    background:#007acc; color:#fff;
    border-color:#007acc; font-weight:600;
  }
  body.light .btn {
    background:#e0e0e0; color:#333;
    border-color:#ccc;
  }
  body.light .btn:hover { background:#d0d0d0; }
  body.light .btn.active {
    background:#007acc; color:#fff;
  }

  /* Size Selector */
  .size-row {
    width:100%;
    display:flex; gap:4px;
    margin-bottom:10px;
  }
  .size-btn {
    flex:1; padding:3px 4px;
    border-radius:4px;
    border:1px solid #3a3a3a;
    background:#252525; color:#888;
    font-size:10px; cursor:pointer;
    text-align:center;
    transition: all 0.15s;
  }
  .size-btn:hover { color:#ccc; }
  .size-btn.active {
    border-color:#007acc; color:#9cdcfe;
    background:#1a2a3a;
  }
  body.light .size-btn {
    background:#e8e8e8; color:#666;
    border-color:#ccc;
  }
  body.light .size-btn.active {
    background:#cce4f7; color:#0e639c;
    border-color:#007acc;
  }

  /* Screen switcher pills (React Navigation) */
  .screen-tabs {
    width:100%;
    display:flex;
    gap:4px;
    margin-bottom:8px;
    overflow-x:auto;
    padding:2px 0 4px 0;
    -webkit-overflow-scrolling:touch;
    scrollbar-width:none;
  }
  .screen-tabs::-webkit-scrollbar {
    display:none;
  }
  .screen-pill {
    flex:0 0 auto;
    padding:3px 8px;
    border-radius:12px;
    border:1px solid #444;
    background:#252525;
    color:#999;
    font-size:10px;
    font-weight:500;
    cursor:pointer;
    white-space:nowrap;
    user-select:none;
    transition: all 0.15s ease;
  }
  .screen-pill:hover {
    background:#333;
    color:#eee;
    border-color:#666;
  }
  .screen-pill.active {
    background:#0e639c;
    color:#fff;
    border-color:#1177bb;
    font-weight:600;
  }
  body.light .screen-pill {
    background:#e4e4e4;
    border-color:#ccc;
    color:#555;
  }
  body.light .screen-pill:hover {
    background:#d8d8d8;
    color:#111;
  }
  body.light .screen-pill.active {
    background:#007acc;
    color:#fff;
    border-color:#007acc;
  }

  /* Live indicator */
  .live {
    font-size:10px; color:#4ec9b0;
    margin-bottom:8px;
    display:flex; align-items:center; gap:4px;
  }
  .live::before {
    content:'';
    width:6px; height:6px;
    background:#4ec9b0;
    border-radius:50%;
    display:inline-block;
  }

  /* Phone frame */
  .phone {
    border:2px solid #555;
    border-radius:24px;
    background:#111;
    display:flex; flex-direction:column;
    overflow:hidden;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    transition: width 0.2s, height 0.2s;
  }
  body.light .phone {
    background:#fff;
    border-color:#999;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }

  /* Android frame style */
  .phone.android {
    border-radius:12px;
  }
  .phone.android .notch {
    width:12px; height:12px;
    border-radius:50%;
    margin:6px auto 2px;
  }
  .phone.android .home {
    width:12px; height:12px;
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
  .notch {
    width:60px; height:10px;
    background:#1e1e1e;
    border-radius:0 0 8px 8px;
    margin:0 auto;
  }
  body.light .notch { background:#ddd; }

  .home {
    width:40px; height:3px;
    background:#555; border-radius:2px;
    margin:4px auto;
  }
  body.light .home { background:#999; }

  /* Wireframe elements */
 .wf-view {
    min-height:24px; background:#3a3a3a;
    border:1px dashed #555;
    border-radius:3px; margin-bottom:4px;
    padding:4px;
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

  /* Click-to-source interactive affordance */
  [data-line] {
    cursor: pointer;
    transition: outline 0.15s ease;
  }
  [data-line]:hover {
    outline: 1px solid #4ec9b0;
  }
  body.light [data-line]:hover {
    outline: 1px solid #0e639c;
  }

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

  <div class="toolbar">
    <div class="btn active" id="btn-ios" onclick="setPlatform('ios')">iOS</div>
    <div class="btn" id="btn-android" onclick="setPlatform('android')">Android</div>
    <div class="btn" id="btn-theme" onclick="toggleTheme()">☀ Light</div>
  </div>

  <div class="size-row">
    <div class="size-btn" id="size-se" onclick="setSize('se')">SE</div>
    <div class="size-btn active" id="size-15" onclick="setSize('15')">iPhone 15</div>
    <div class="size-btn" id="size-ipad" onclick="setSize('ipad')">iPad</div>
  </div>

  <!-- Screen Switcher Tabs (React Navigation) -->
  ${screens.length > 0 ? `
  <div class="screen-tabs" id="screen-tabs">
    ${screens.map((s, idx) => `
      <div class="screen-pill ${idx === selectedIndex ? 'active' : ''}" id="screen-pill-${idx}" onclick="selectScreen(${idx})">
        ${escapeHtml(s.name)}
      </div>
    `).join('')}
  </div>` : ''}

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
      <span class="value" id="comp-name">${escapeHtml(name)}</span>
    </div>
    ${navigatorTypeName ? `
    <div class="info-row">
      <span class="label">NAVIGATOR:</span>
      <span class="value" id="nav-label">${escapeHtml(navigatorTypeName)}</span>
    </div>` : ''}
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
  const vscode = acquireVsCodeApi();

  const screensData = ${JSON.stringify(screens.map(s => ({
    name: s.name,
    componentName: s.componentName,
    wireframe: s.wireframe,
    filePath: s.filePath
  })))};
  let activeScreenIndex = ${selectedIndex};

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function selectScreen(index) {
    if (!screensData || !screensData[index]) return;
    activeScreenIndex = index;
    const targetScreen = screensData[index];

    // Update pill styles
    document.querySelectorAll('.screen-pill').forEach((p, idx) => {
      p.classList.toggle('active', idx === index);
    });

    // Update wireframe
    const screenEl = document.getElementById('screen');
    if (screenEl) {
      screenEl.innerHTML = targetScreen.wireframe;
    }

    // Update info bar
    const compNameEl = document.getElementById('comp-name');
    if (compNameEl) {
      compNameEl.textContent = targetScreen.componentName || targetScreen.name;
    }

    // Notify extension host
    vscode.postMessage({
      command: 'selectScreen',
      index: index,
      filePath: targetScreen.filePath
    });
  }

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
    setSize(currentSize);
  }

  function toggleTheme() {
    isDark = !isDark;
    document.getElementById('body').className = isDark ? '' : 'light';
    document.getElementById('btn-theme').textContent = isDark ? '☀ Light' : '🌙 Dark';
  }

  setSize('15');

  const screenEl = document.getElementById('screen');
  if (screenEl) {
    screenEl.addEventListener('click', (event) => {
      const target = event.target.closest('[data-line]');
      if (!target) return;
      const lineStr = target.getAttribute('data-line');
      const line = parseInt(lineStr, 10);
      if (!isNaN(line)) {
        const currentFile = (screensData && screensData[activeScreenIndex])
          ? screensData[activeScreenIndex].filePath
          : undefined;
        vscode.postMessage({
          command: 'revealLine',
          line: line,
          filePath: currentFile
        });
      }
    });
  }
</script>
</body>
</html>`;
	}
}

export function deactivate() {}