# RN Previewer

Live wireframe preview of React Native components — directly inside VS Code and Cursor. No simulator. No Expo. Just open your file.

![RN Previewer](media/icon.png)

## What it does

When you open any React Native `.tsx` or `.jsx` file, a sidebar panel shows:

- A phone frame mockup (iPhone or Android)
- A wireframe preview of your component structure
- Component name and platform info
- Updates live as you type

## Features

- **Live preview** — updates instantly as you edit your file
- **iOS & Android** — toggle between iPhone and Android frame
- **Dark & Light theme** — see how your layout looks in both modes
- **Multiple screen sizes** — iPhone SE, iPhone 15, and iPad
- **Zero setup** — no simulator, no dependencies, no config

## Supported Elements

| Element | Wireframe |
|---|---|
| View | Dashed rectangle |
| Text | Grey lines |
| Image | Circle |
| Button / TouchableOpacity / Pressable | Rounded rectangle |
| TextInput | Input box |
| FlatList / ScrollView | List items |

## How to use

1. Install the extension
2. Open any `.tsx` or `.jsx` React Native file
3. Click the phone icon in the activity bar
4. See your component structure instantly

## Tech

Built with TypeScript, VS Code Webview API. Zero paid APIs. Zero cost.

## Author

Built by [@ErrorInshanu](https://github.com/ErrorInshanu)