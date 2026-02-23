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

function normalizeImmichUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

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
		this.settings.immichUrl = normalizeImmichUrl(this.settings.immichUrl);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ImageSelectorModal extends Modal {
	editor: Editor;
	settings: PluginSettings;
	currentPage: number;
	batchSize: number;
	loadedAssets: Map<number, HTMLElement>;
	scrollContainer: HTMLElement | null;
	isLoading: boolean;
	scrollTimeout: number | null;

	constructor(app: App, editor: Editor, settings: PluginSettings) {
		super(app);
		this.editor = editor;
		this.settings = settings;
		this.currentPage = 0;
		this.batchSize = 6;
		this.loadedAssets = new Map();
		this.scrollContainer = null;
		this.isLoading = false;
		this.scrollTimeout = null;
	}

	async onOpen() {
		const {contentEl} = this;

		if (cachedResult == null) {
			await refreshCacheFromImmich(this.settings);
		}

		// Create header with title and refresh button
		const header = contentEl.createDiv({cls: 'obsidian-immich-header'});
		
		const titleDiv = header.createDiv({cls: 'obsidian-immich-title'});
		titleDiv.setText('Insert from album: ' + (cachedResult.json['albumName'] || 'Select Image'));
		
		const refreshButton = header.createEl('button', {
			text: '\u21bb',
			cls: 'obsidian-immich-refresh-button'
		});
		refreshButton.onclick = async () => {
			refreshButton.disabled = true;
			refreshButton.setText('Loading...');
			try {
				await refreshCacheFromImmich(this.settings, false);
				// Reload the modal
				this.onClose();
				this.onOpen();
			} catch (error) {
				new Notice('Failed to refresh cache');
				console.error('Refresh failed:', error);
				refreshButton.disabled = false;
				refreshButton.setText('\u21bb Refresh');
			}
		};

		const totalWidth = contentEl.innerWidth;
		const totalAssets = cachedResult.json['assets'].length;

		// Create scroll container
		this.scrollContainer = contentEl.createDiv({cls: 'obsidian-immich-scroll-container'});
		this.scrollContainer.setAttribute('data-immich-modal-content', 'true');
		this.scrollContainer.style.maxHeight = '70vh';
		this.scrollContainer.style.overflowY = 'auto';

		const row = this.scrollContainer.createDiv({cls: 'obsidian-immich-row'});
		const leftImageDiv = row.createDiv({cls: 'obsidian-immich-column'});
		const rightImageDiv = row.createDiv({cls: 'obsidian-immich-column'});
		const left = leftImageDiv.createDiv({cls: 'obsidian-immich-column-content'});
		const right = rightImageDiv.createDiv({cls: 'obsidian-immich-column-content'});

		// Create loading indicator inside scroll container
		const loadingDiv = this.scrollContainer.createDiv({cls: 'obsidian-immich-loading'});
		loadingDiv.setText('Loading images...');
		loadingDiv.style.display = 'none';

		// Setup scroll listener with throttling
		this.setupScrollListener(left, right, totalWidth, totalAssets, loadingDiv);
		
		// Initial load: load more items to ensure scrollbar appears on large screens
		const initialBatchSize = Math.max(this.batchSize * 3, 20); // Load at least 20 items initially
		this.loadBatch(left, right, totalWidth, 0, Math.min(initialBatchSize, totalAssets), loadingDiv, totalAssets);
	}

	private setupScrollListener(left: HTMLElement, right: HTMLElement, totalWidth: number, totalAssets: number, loadingDiv: HTMLElement) {
		if (!this.scrollContainer) return;

		this.scrollContainer.addEventListener('scroll', () => {
			if (this.scrollTimeout) {
				clearTimeout(this.scrollTimeout);
			}

			this.scrollTimeout = window.setTimeout(() => {
				this.checkAndLoadMore(left, right, totalWidth, totalAssets, loadingDiv);
			}, 150); // Throttle to 150ms
		});
	}

	private checkAndLoadMore(left: HTMLElement, right: HTMLElement, totalWidth: number, totalAssets: number, loadingDiv: HTMLElement) {
		if (!this.scrollContainer || this.isLoading || this.currentPage >= totalAssets) {
			return;
		}

		const scrollTop = this.scrollContainer.scrollTop;
		const scrollHeight = this.scrollContainer.scrollHeight;
		const clientHeight = this.scrollContainer.clientHeight;
		const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

		// Load more when user scrolls past 60% or when near bottom
		if (scrollPercentage > 0.6 || (scrollHeight - (scrollTop + clientHeight) < 300)) {
			const endIndex = Math.min(this.currentPage + this.batchSize, totalAssets);
			this.loadBatch(left, right, totalWidth, this.currentPage, endIndex, loadingDiv, totalAssets);
		}
	}

	private loadBatch(left: HTMLElement, right: HTMLElement, totalWidth: number, startIndex: number, endIndex: number, loadingDiv: HTMLElement, totalAssets: number) {
		if (this.isLoading || startIndex >= totalAssets) return;
		
		this.isLoading = true;
		loadingDiv.style.display = 'block';

		const assets = cachedResult.json['assets'];

		for (let i = startIndex; i < endIndex; i++) {
			if (this.loadedAssets.has(i)) continue;

			const asset = assets[i];
			const thumbUrl = this.settings.immichUrl + '/api/assets/' + asset['id'] + '/thumbnail?size=thumbnail&key=' + this.settings.immichAlbumKey;
			
			let insertionText: string;
			if (asset['type'] === "IMAGE") {
				const previewUrl = this.settings.immichUrl + '/api/assets/' + asset['id'] + '/thumbnail?size=preview&key=' + this.settings.immichAlbumKey;
				insertionText = '![](' + previewUrl + ')\n';
			} else if (asset['type'] === "VIDEO") {
				insertionText = '<video src="' + this.settings.immichUrl + '/api/assets/' + asset['id'] + '/video/playback?key=' + this.settings.immichAlbumKey + '" controls></video>\n';
			}

			const targetColumn = (i & 1) ? right : left;
			const overallDiv = targetColumn.createDiv({cls: 'obsidian-immich-overallDiv'});
			
			const imgElement = overallDiv.createEl("img");
			imgElement.src = thumbUrl;
			imgElement.width = (totalWidth / 2) - 5;
			imgElement.style.cursor = 'pointer';
			
			imgElement.onclick = () => {
				this.editor.replaceSelection(insertionText);
				overallDiv.setCssStyles({opacity: '0.5'});
			};

			imgElement.onerror = () => {
				overallDiv.setText('Failed to load');
			};

			this.loadedAssets.set(i, overallDiv);
		}

		this.currentPage = endIndex;

		setTimeout(() => {
			this.isLoading = false;
			if (endIndex >= totalAssets) {
				loadingDiv.style.display = 'none';
			}
		}, 100);
	}

	onClose() {
		if (this.scrollTimeout) {
			clearTimeout(this.scrollTimeout);
		}
		this.loadedAssets.clear();
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
					this.plugin.settings.immichUrl = normalizeImmichUrl(value);
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
