import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, RequestUrlResponse, Setting, requestUrl } from 'obsidian';

interface PluginSettings {
	immichUrl: string;
	immichApiKey: string;
	immichAlbum: string;
	immichAlbumKey: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	immichUrl: '',
	immichApiKey: '',
	immichAlbum: '',
	immichAlbumKey: ''
}

let cachedResult: RequestUrlResponse;

async function testConnection(settings: PluginSettings) {
	new Notice("Testing connection to " + settings.immichUrl)
	const url = new URL(settings.immichUrl + '/api/server/about');
	try {
		const result = await requestUrl({
			url: url.toString(),
			headers: {
				'Accept': 'application/json',
				'x-api-key': settings.immichApiKey.toString()
			}
		})
		if (result.status == 200) {
			new Notice("Connection successful")
		}
	} catch(exception) {
		new Notice("Failed to connect to " + settings.immichUrl + " - check the console for additional information.")
		console.log("Failed connection to " + url + " with error: " + exception)
	}	
}

async function refreshCacheFromImmich(settings: PluginSettings, silent=true) {
	const url = new URL(settings.immichUrl + '/api/albums/' + settings.immichAlbum);
	const result = await requestUrl({
		url: url.toString(),
		headers: {
			'Accept': 'application/json',
			'x-api-key': settings.immichApiKey.toString()
		}
	})	
	cachedResult = result;
	if(!silent) {
		new Notice('Immich album cache completed for album \'' + cachedResult.json['albumName'] + '\'. Found ' + cachedResult.json['assetCount'] + ' assets.');
	}
}

export default class ObsidianImmich extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'insert-from-album',
			name: 'Insert from album',
			editorCallback: (editor: Editor) => {
				new ImageSelectorModal(this.app, editor, this.settings).open();
			}
		});
 
		this.addCommand({
			id: 'force-refresh-album-cache',
			name: 'Refresh album cache',
			callback: () => {
				new Notice('Refreshing immich cache.');
				refreshCacheFromImmich(this.settings, false);
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ImageSelectorModal extends Modal {
	editor: Editor;
	settings: PluginSettings;
	page: number;

	constructor(app: App, editor: Editor, settings: PluginSettings) {
		super(app);
		this.editor = editor;
		this.settings = settings;
		this.page = 0;
	}

	async onOpen() {
		const {contentEl} = this;

		if (cachedResult == null) {
			await refreshCacheFromImmich(this.settings);
		}

		// Get the width of the viewport
		const totalWidth = contentEl.innerWidth;

		const row = contentEl.createDiv({cls: 'obsidian-immich-row'});
		const leftImageDiv = row.createDiv({cls: 'obsidian-immich-column'});
		const rightImageDiv = row.createDiv({cls: 'obsidian-immich-column'});
		const left = leftImageDiv.createDiv();
		const right = rightImageDiv.createDiv();
		const leftBottom = leftImageDiv.createDiv();
		const rightBottom = rightImageDiv.createDiv();
		let observer = new IntersectionObserver(() => {
			const startIndex = this.page;
			let endIndex = this.page + 10;
			if (endIndex > cachedResult.json['assets'].length) {
				endIndex = cachedResult.json['assets'].length;
			}
			this.page = endIndex;
			for (let i = startIndex; i < endIndex; i++) {
				const thumbUrl = this.settings.immichUrl + '/api/assets/' + cachedResult.json['assets'][i]['id'] + '/thumbnail?size=thumbnail&key=' + this.settings.immichAlbumKey;
				let insertionText: string;
				if (cachedResult.json['assets'][i]['type'] === "IMAGE") {
					const previewUrl = this.settings.immichUrl + '/api/assets/' + cachedResult.json['assets'][i]['id'] + '/thumbnail?size=preview&key=' + this.settings.immichAlbumKey;
					insertionText = '![](' + previewUrl + ')\n';
				} else if (cachedResult.json['assets'][i]['type'] === "VIDEO") {
					insertionText = '<video src="' + this.settings.immichUrl + '/api/assets/' + cachedResult.json['assets'][i]['id'] + '/video/playback?key=' + this.settings.immichAlbumKey + '"controls></video>\n';
				}
				const overallDiv = ( i & 1 ) ? right.createDiv({cls: 'obsidian-immich-overallDiv'}) : left.createDiv({cls: 'obsidian-immich-overallDiv'});
				const imgElement = overallDiv.createEl("img");
				imgElement.src = thumbUrl;
				imgElement.width = (totalWidth / 2) - 5;
				imgElement.onclick = () => {
					this.editor.replaceSelection(insertionText);
					overallDiv.setCssStyles({opacity: '0.5'})
				}
			}
			
		}, {threshold: [0.1]});
		observer.observe(leftBottom);
		observer.observe(rightBottom);
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SettingTab extends PluginSettingTab {
	plugin: ObsidianImmich;

	constructor(app: App, plugin: ObsidianImmich) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Immich URL')
			.setDesc('Full URL to your immich instance.')
			.addText(text => text
				.setValue(this.plugin.settings.immichUrl)
				.onChange(async (value) => {
					this.plugin.settings.immichUrl = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Immich API key')
			.setDesc('Obtained from {IMMICH_URL}/user-settings?isOpen=api-keys.')
			.addText(text => text
				.setValue(this.plugin.settings.immichApiKey)
				.onChange(async (value) => {
					this.plugin.settings.immichApiKey = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Immich album ID')
			.setDesc('UUID for the `obsidian` album in immich.')
			.addText(text => text
				.setValue(this.plugin.settings.immichAlbum)
				.onChange(async (value) => {
					this.plugin.settings.immichAlbum = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Immich album share key')
			.setDesc('Share key which shows up in the URL of your album.')
			.addText(text => text
				.setValue(this.plugin.settings.immichAlbumKey)
				.onChange(async (value) => {
					this.plugin.settings.immichAlbumKey = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Validate the connection between obsidian and your immich instance.')
			.addButton(async (button) => {
				button.setButtonText("Test connection")
				button.onClick(async() => {
					testConnection(this.plugin.settings)
				})
			})
	}
}
