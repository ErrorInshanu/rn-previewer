# RN Previewer

**Live wireframe preview of React Native components — directly inside VS Code and Cursor.**

No simulator. No Expo. No setup. Just open your `.tsx` file and instantly see your component structure — with real text, real styling, and real layout — inside a phone mockup.

---

## Preview

Open any React Native file and see this instantly in your sidebar:

- 📱 Phone frame with notch and home indicator
- 🟩 Real styled boxes — actual colors, sizes, and layout from your `StyleSheet`
- 🔤 Real text — your actual copy, button labels, and input placeholders
- 🟢 Live green dot that updates as you type
- 🖱️ Click any element to jump straight to that line of code
- 📊 Component name and platform info at the bottom

---

## Features

- ⚡ **Live preview** — updates instantly as you edit, even on unsaved files
- 🧠 **Real parsing, not guesswork** — built on a proper AST (Abstract Syntax Tree), so nesting, structure, and component names are accurate, not just pattern-matched
- 🎨 **StyleSheet-aware layout** — width, height, background color, padding, margin, border radius, and `flexDirection` from your `StyleSheet.create()` are reflected directly in the wireframe
- 🔤 **Real content** — `<Text>` shows your actual copy, buttons show their real labels, `<TextInput>` shows its real placeholder
- 🧭 **React Navigation support** — detects Bottom Tab, Drawer, and Stack navigators, extracts your screens across files, and lets you switch between them right in the preview
- 🖱️ **Click-to-source** — click any wireframe element to jump straight to that line in your code
- 📱 **iOS & Android frames** — toggle between iPhone and Android mockup
- ☀️ **Dark & Light theme** — see your layout in both modes
- 📐 **Multiple screen sizes** — iPhone SE, iPhone 15, iPad
- 🚀 **Zero setup** — install, open any RN file, it just works

---

## Supported Components

| Component | Wireframe Representation |
|---|---|
| `<View>` | Styled container — reflects real size, color, padding, and layout when available |
| `<Text>` | Your real text content, or placeholder lines if dynamic |
| `<Image>` | Styled shape matching real dimensions, or a generic circle |
| `<TouchableOpacity>` / `<Pressable>` / `<Button>` | Real button label, uppercased |
| `<TextInput>` | Input box showing your real placeholder text |
| `<FlatList>` / `<ScrollView>` | Stacked list items |

---

## React Navigation

If your file uses `createBottomTabNavigator`, `createDrawerNavigator`, or `createNativeStackNavigator` / `createStackNavigator`, RN Previewer:

- Detects the navigator and lists its screens as tabs above the preview
- Resolves each screen's component across files, so you can preview screens you haven't even opened yet
- Lets you click between screens without leaving the navigator file
- Keeps click-to-source pointed at the correct underlying screen file, not just the navigator

---

## How to Use

1. Install **RN Previewer** from the marketplace
2. Open any `.tsx` or `.jsx` React Native file
3. Click the **phone icon** in the left activity bar
4. Your component structure appears instantly — styled, with real content
5. Click any element in the wireframe to jump to that line of code
6. Toggle iOS/Android, Dark/Light, and screen sizes using the toolbar

---

## Why RN Previewer?

React Native developers waste time running simulators just to check if a component looks right structurally. RN Previewer shows you the real structure, styling, and content of any component — instantly, with no simulator, no build time, and no waiting.

---

## Works With

- VS Code
- Cursor
- Any `.tsx` or `.jsx` React Native file

---

## Tech

Built with TypeScript, the VS Code Webview API, and Babel (`@babel/parser` + `@babel/traverse`) for real AST-based parsing.

---

## Author

Built by [Shanu Singh](https://github.com/ErrorInshanu)

⭐ If you find this useful, please leave a rating on the marketplace!