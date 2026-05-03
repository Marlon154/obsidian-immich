# Obsidian ❤️ Immich

This is a fork of [obsidian-immich](https://github.com/mentioned-gg/obsidian-immich) with extended functionality. The original plugin supports inserting images from a single shared Immich album. This fork replaces that model with full-library browsing, live search, date filtering, and a code block embed mode that keeps API keys out of your notes.

## Changes from the original

- **Full library access**: Browse all assets in your Immich library instead of a single album. An optional album ID can still be set to restrict browsing to one album.
- **No album share key required**: The album share key setting has been removed. Image URLs are authenticated using the API key directly (`?apiKey=...`), which works fine for local instances.
- **Live search**: A search bar at the top of the modal lets you search by filename and description (metadata search) or use Immich's semantic smart search. Results are fetched live — no local cache.
- **Date range filter**: Optional from/to date pickers to narrow results by capture date.
- **Code block embed mode**: Images are inserted as `immich` code blocks that store only the asset ID. The URL and API key are resolved from plugin settings at render time — they are never written to your notes.
- **Slider**: Select multiple images and insert them as a slider embed.
- **Open in Immich**: A hover icon on each rendered embed links directly to the asset in your Immich instance.
- **No upfront cache**: Images are fetched on demand in pages as you scroll. The "Refresh album cache" command has been removed.
- **macOS note**: macOS requires explicit Local Network permission for apps accessing private IPs. If the plugin cannot connect, go to System Settings > Privacy & Security > Local Network and enable Obsidian.

## Prerequisites

A working self-hosted [Immich](https://github.com/immich-app/immich) instance. The instance does not need to be remotely accessible.

## Setup

**Immich**

1. Generate an API key: `https://your-immich-url/user-settings?isOpen=api-keys`

**Obsidian**

1. Install the plugin.
2. Fill in the settings:
   - **Immich URL**: full URL to your Immich instance, without a trailing slash.
   - **Immich API key**: the key from the Immich step above.
   - **Album ID** (optional): leave empty to browse your full library, or enter an album UUID to restrict browsing to that album.
   - **Insert mode**: choose *Code block* (recommended) or *Full URL* (see below).
3. Click "Test connection" to verify. Open the developer console (`cmd+option+i` on macOS, `ctrl+shift+i` on Windows) for detailed error output if needed.

## Usage

1. Open a note in editor view.
2. Open the command palette (`ctrl/cmd+p`).
3. Run **Insert from Immich**.
4. Use the search bar and date filters to find images.
5. Click an image to insert it immediately, or enable **Select multiple** in the footer to build a slider (click multiple images, then **Insert (N)**).

Hovering over a rendered embed reveals a small icon in the top-left corner that opens the asset directly in Immich.

### Search modes

- **Metadata**: searches by filename and description. Works without a search query (browses all assets).
- **Smart**: semantic search using Immich's machine learning index. Requires a search query.

### Album filter

If an album ID is configured in settings, metadata browsing and search are restricted to that album. Smart search searches the full library regardless.

## Insert modes

### Code block (recommended)

Images are stored as a fenced code block containing only the asset ID and type:

````markdown
```immich
3e4f5a6b-... IMAGE
9c8d7e2f-... IMAGE
```
````

The plugin renders these at read time using the URL and API key from settings. Your API key is never written to your notes. A single entry renders as a plain image or video; multiple entries render as a slider.

### Full URL

Images are stored as standard markdown embeds:

```markdown
![](https://your-immich/api/assets/.../thumbnail?size=preview&apiKey=secret)
```

This is compatible with any markdown renderer but exposes your API key in note content.

### Converting between modes

Two commands are available in the command palette to convert the current note in either direction:

- **Convert note: Immich URLs → code blocks**
- **Convert note: Immich code blocks → URLs**