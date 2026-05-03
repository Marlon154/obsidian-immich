import { App, Editor, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// requestUrl goes through Chrome's network stack which blocks private IPs (PNA restriction).
// Node.js http/https modules bypass this and work fine for local Immich instances.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require('http');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const https = require('https');

interface NodeResponse {
	status: number;
	json: any;
}

function nodeRequest(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<NodeResponse> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const transport = parsed.protocol === 'https:' ? https : http;
		const req = transport.request({
			hostname: parsed.hostname,
			port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
			path: parsed.pathname + parsed.search,
			method: options.method || 'GET',
			headers: options.headers || {}
		}, (res: any) => {
			let data = '';
			res.on('data', (chunk: string) => { data += chunk; });
			res.on('end', () => {
				try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
				catch { resolve({ status: res.statusCode, json: null }); }
			});
		});
		req.on('error', reject);
		if (options.body) req.write(options.body);
		req.end();
	});
}

interface PluginSettings {
	immichUrl: string;
	immichApiKey: string;
	immichAlbum: string;
	insertMode: 'url' | 'codeblock';
}

const DEFAULT_SETTINGS: PluginSettings = {
	immichUrl: '',
	immichApiKey: '',
	immichAlbum: '',
	insertMode: 'codeblock',
}

function normalizeImmichUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

interface AssetEntry {
	id: string;
	type: string;
}

function parseImmichBlock(source: string): AssetEntry[] {
	return source.trim().split('\n')
		.map(l => l.trim())
		.filter(l => l.length > 0)
		.map(l => {
			const [id, type] = l.split(/\s+/);
			return { id, type: (type || 'IMAGE').toUpperCase() };
		});
}

function buildFullUrl(entry: AssetEntry, settings: PluginSettings): string {
	const base = settings.immichUrl + '/api/assets/' + entry.id;
	if (entry.type === 'VIDEO') {
		return '<video src="' + base + '/video/playback?apiKey=' + settings.immichApiKey + '" controls></video>';
	}
	return '![](' + base + '/thumbnail?size=preview&apiKey=' + settings.immichApiKey + ')';
}

function buildCodeblock(entries: AssetEntry[]): string {
	const lines = entries.map(e => e.id + ' ' + e.type).join('\n');
	return '```immich\n' + lines + '\n```';
}

// Converts all full Immich asset URLs in a note to immich code blocks.
// Matches any host so it works even if the configured URL changed.
function urlsToCodeblocks(content: string): string {
	content = content.replace(
		/!\[[^\]]*\]\(https?:\/\/[^/]+\/api\/assets\/([0-9a-f-]+)\/thumbnail\?[^)]*\)/g,
		(_, id) => buildCodeblock([{ id, type: 'IMAGE' }])
	);
	content = content.replace(
		/<video\s+src="https?:\/\/[^/]+\/api\/assets\/([0-9a-f-]+)\/video\/playback\?[^"]*"\s*controls><\/video>/g,
		(_, id) => buildCodeblock([{ id, type: 'VIDEO' }])
	);
	return content;
}

// Converts all immich code blocks in a note to full URLs using current settings.
function codeblocksToUrls(content: string, settings: PluginSettings): string {
	return content.replace(
		/```immich\n([\s\S]*?)```/g,
		(_, blockContent) => {
			const entries = parseImmichBlock(blockContent);
			return entries.map(e => buildFullUrl(e, settings)).join('\n');
		}
	);
}

function addOpenButton(container: HTMLElement, url: string) {
	const btn = container.createEl('a', { cls: 'immich-open-btn' });
	btn.href = url;
	btn.target = '_blank';
	btn.rel = 'noopener';
	btn.title = 'Open in Immich';
	// external link icon (↗)
	btn.createSvg('svg', { attr: { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } }, svg => {
		svg.createSvg('line', { attr: { x1: '7', y1: '17', x2: '17', y2: '7' } });
		svg.createSvg('polyline', { attr: { points: '7 7 17 7 17 17' } });
	});
}

function renderSingleEmbed(el: HTMLElement, entry: AssetEntry, settings: PluginSettings) {
	const base = settings.immichUrl + '/api/assets/' + entry.id;
	const wrapper = el.createDiv({ cls: 'immich-embed-wrapper' });
	if (entry.type === 'VIDEO') {
		const video = wrapper.createEl('video', { cls: 'immich-embed-video' });
		video.src = base + '/video/playback?apiKey=' + settings.immichApiKey;
		video.controls = true;
	} else {
		const img = wrapper.createEl('img', { cls: 'immich-embed-img' });
		img.src = base + '/thumbnail?size=preview&apiKey=' + settings.immichApiKey;
	}
	addOpenButton(wrapper, settings.immichUrl + '/photos/' + entry.id);
}

function renderSlider(el: HTMLElement, entries: AssetEntry[], settings: PluginSettings) {
	const container = el.createDiv({ cls: 'immich-slider' });
	let current = 0;

	const track = container.createDiv({ cls: 'immich-slider-track' });
	const slides: HTMLElement[] = entries.map((entry, i) => {
		const slide = track.createDiv({ cls: 'immich-slide' + (i === 0 ? ' immich-slide-active' : '') });
		const base = settings.immichUrl + '/api/assets/' + entry.id;
		if (entry.type === 'VIDEO') {
			const video = slide.createEl('video', { cls: 'immich-embed-video' });
			video.src = base + '/video/playback?apiKey=' + settings.immichApiKey;
			video.controls = true;
		} else {
			const img = slide.createEl('img', { cls: 'immich-embed-img' });
			img.src = base + '/thumbnail?size=preview&apiKey=' + settings.immichApiKey;
		}
		addOpenButton(slide, settings.immichUrl + '/photos/' + entry.id);
		return slide;
	});

	const controls = container.createDiv({ cls: 'immich-slider-controls' });
	const prev = controls.createEl('button', { cls: 'immich-slider-btn', text: '‹' });
	const dotsEl = controls.createDiv({ cls: 'immich-slider-dots' });
	const dotEls = entries.map((_, i) => {
		const dot = dotsEl.createDiv({ cls: 'immich-dot' + (i === 0 ? ' immich-dot-active' : '') });
		dot.onclick = () => goTo(i);
		return dot;
	});
	const next = controls.createEl('button', { cls: 'immich-slider-btn', text: '›' });

	const counter = controls.createDiv({ cls: 'immich-slider-counter' });
	counter.setText('1 / ' + entries.length);

	function goTo(index: number) {
		slides[current].removeClass('immich-slide-active');
		dotEls[current].removeClass('immich-dot-active');
		current = (index + entries.length) % entries.length;
		slides[current].addClass('immich-slide-active');
		dotEls[current].addClass('immich-dot-active');
		counter.setText((current + 1) + ' / ' + entries.length);
	}

	prev.onclick = () => goTo(current - 1);
	next.onclick = () => goTo(current + 1);
}

interface SearchResult {
	items: any[];
	nextPage: number | null;
	total: number;
}

async function searchAssets(
	settings: PluginSettings,
	query: string,
	isSmart: boolean,
	pageSize: number,
	dateFrom: string,
	dateTo: string,
	page: number
): Promise<SearchResult> {
	const useSmartSearch = isSmart && query.trim().length > 0;
	const endpoint = useSmartSearch ? '/api/search/smart' : '/api/search/metadata';

	const body: Record<string, any> = { size: pageSize, page };
	if (query.trim()) body['query'] = query.trim();
	if (dateFrom) body['takenAfter'] = new Date(dateFrom).toISOString();
	if (dateTo) body['takenBefore'] = new Date(dateTo + 'T23:59:59').toISOString();
	if (settings.immichAlbum && !useSmartSearch) body['albumIds'] = [settings.immichAlbum];

	const result = await nodeRequest(settings.immichUrl + endpoint, {
		method: 'POST',
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'x-api-key': settings.immichApiKey
		},
		body: JSON.stringify(body)
	});

	const assets = result.json['assets'];
	return {
		items: assets['items'] || [],
		nextPage: assets['nextPage'] ? parseInt(assets['nextPage']) : null,
		total: assets['total'] ?? assets['count'] ?? 0
	};
}

async function testConnection(settings: PluginSettings) {
	new Notice('Testing connection...');
	try {
		const result = await nodeRequest(settings.immichUrl + '/api/server/about', {
			headers: { 'Accept': 'application/json', 'x-api-key': settings.immichApiKey }
		});
		if (result.status === 200) {
			new Notice('Connection successful');
		} else {
			new Notice('Unexpected status: ' + result.status);
			return;
		}
	} catch (e) {
		new Notice('Failed to connect — check console for details.');
		console.error('[Immich] Connection failed:', e);
		return;
	}

	try {
		const search = await searchAssets(settings, '', false, 1, '', '', 1);
		new Notice('API key valid — library contains ' + search.total + ' assets.');
	} catch (e) {
		new Notice('API key invalid or search failed — check console.');
		console.error('[Immich] Search test failed:', e);
		return;
	}

	if (settings.immichAlbum) {
		try {
			const result = await nodeRequest(settings.immichUrl + '/api/albums/' + settings.immichAlbum, {
				headers: { 'Accept': 'application/json', 'x-api-key': settings.immichApiKey }
			});
			if (result.status === 200) {
				new Notice('Album found: "' + result.json['albumName'] + '" (' + result.json['assetCount'] + ' assets).');
			}
		} catch (e) {
			new Notice('Album ID not found — check console.');
			console.error('[Immich] Album access failed:', e);
		}
	}
}

export default class ObsidianImmich extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor('immich', (source, el) => {
			const entries = parseImmichBlock(source);
			if (entries.length === 0) {
				el.createEl('em', { text: 'No assets specified.' });
				return;
			}
			if (entries.length === 1) {
				renderSingleEmbed(el, entries[0], this.settings);
			} else {
				renderSlider(el, entries, this.settings);
			}
		});

		this.addCommand({
			id: 'insert-from-immich',
			name: 'Insert from Immich',
			editorCallback: (editor: Editor) => {
				new ImageSelectorModal(this.app, editor, this.settings).open();
			}
		});

		this.addCommand({
			id: 'convert-to-codeblocks',
			name: 'Convert note: Immich URLs → code blocks',
			editorCallback: (editor: Editor) => {
				const before = editor.getValue();
				const after = urlsToCodeblocks(before);
				if (after !== before) {
					editor.setValue(after);
					new Notice('Converted Immich URLs to code blocks.');
				} else {
					new Notice('No Immich URLs found in this note.');
				}
			}
		});

		this.addCommand({
			id: 'convert-to-urls',
			name: 'Convert note: Immich code blocks → URLs',
			editorCallback: (editor: Editor) => {
				const before = editor.getValue();
				const after = codeblocksToUrls(before, this.settings);
				if (after !== before) {
					editor.setValue(after);
					new Notice('Converted code blocks to Immich URLs.');
				} else {
					new Notice('No Immich code blocks found in this note.');
				}
			}
		});

		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}

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

	query = '';
	isSmart = false;
	dateFrom = '';
	dateTo = '';

	currentPage = 1;
	hasMore = true;
	isLoading = false;
	loadedCount = 0;
	totalWidth = 0;
	pageSize = 20;

	selectedAssets: Map<string, AssetEntry> = new Map();
	multiSelect = false;

	scrollContainer: HTMLElement | null = null;
	leftColumn: HTMLElement | null = null;
	rightColumn: HTMLElement | null = null;
	loadingDiv: HTMLElement | null = null;
	countDiv: HTMLElement | null = null;
	insertBtn: HTMLButtonElement | null = null;
	multiSelectBtn: HTMLButtonElement | null = null;

	searchTimeout: number | null = null;
	scrollTimeout: number | null = null;

	constructor(app: App, editor: Editor, settings: PluginSettings) {
		super(app);
		this.editor = editor;
		this.settings = settings;
	}

	async onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass('obsidian-immich-modal');
		this.totalWidth = contentEl.innerWidth;
		this.buildUI(contentEl);
		await this.fetchNextPage();
	}

	private buildUI(contentEl: HTMLElement) {
		const header = contentEl.createDiv({ cls: 'obsidian-immich-header' });
		header.createDiv({ cls: 'obsidian-immich-title' }).setText('Insert from Immich');
		this.countDiv = header.createDiv({ cls: 'obsidian-immich-count' });

		const searchBar = contentEl.createDiv({ cls: 'obsidian-immich-search-bar' });

		const searchInput = searchBar.createEl('input', { cls: 'obsidian-immich-search-input' });
		searchInput.type = 'text';
		searchInput.placeholder = 'Search images...';
		searchInput.oninput = () => {
			if (this.searchTimeout) clearTimeout(this.searchTimeout);
			this.searchTimeout = window.setTimeout(() => {
				this.query = searchInput.value;
				this.resetAndSearch();
			}, 300);
		};

		const toggleBtn = searchBar.createEl('button', {
			text: 'Metadata',
			cls: 'obsidian-immich-toggle-btn'
		});
		toggleBtn.onclick = () => {
			this.isSmart = !this.isSmart;
			toggleBtn.setText(this.isSmart ? 'Smart' : 'Metadata');
			toggleBtn.toggleClass('obsidian-immich-toggle-active', this.isSmart);
			this.resetAndSearch();
		};

		const dateRow = contentEl.createDiv({ cls: 'obsidian-immich-date-row' });
		dateRow.createEl('label', { text: 'From:' });
		const fromInput = dateRow.createEl('input', { cls: 'obsidian-immich-date-input' });
		fromInput.type = 'date';
		fromInput.onchange = () => { this.dateFrom = fromInput.value; this.resetAndSearch(); };

		dateRow.createEl('label', { text: 'To:' });
		const toInput = dateRow.createEl('input', { cls: 'obsidian-immich-date-input' });
		toInput.type = 'date';
		toInput.onchange = () => { this.dateTo = toInput.value; this.resetAndSearch(); };

		this.scrollContainer = contentEl.createDiv({ cls: 'obsidian-immich-scroll-container' });
		this.scrollContainer.style.maxHeight = '55vh';
		this.scrollContainer.style.overflowY = 'auto';

		const row = this.scrollContainer.createDiv({ cls: 'obsidian-immich-row' });
		this.leftColumn = row.createDiv({ cls: 'obsidian-immich-column' }).createDiv({ cls: 'obsidian-immich-column-content' });
		this.rightColumn = row.createDiv({ cls: 'obsidian-immich-column' }).createDiv({ cls: 'obsidian-immich-column-content' });

		this.loadingDiv = this.scrollContainer.createDiv({ cls: 'obsidian-immich-loading' });
		this.loadingDiv.setText('Loading...');
		this.loadingDiv.style.display = 'none';

		this.scrollContainer.addEventListener('scroll', () => {
			if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
			this.scrollTimeout = window.setTimeout(() => this.checkAndLoadMore(), 150);
		});

		const footer = contentEl.createDiv({ cls: 'obsidian-immich-footer' });
		const modeLabel = footer.createEl('span', { cls: 'obsidian-immich-mode-label' });
		modeLabel.setText(this.settings.insertMode === 'codeblock' ? 'Code block' : 'Full URL');

		const footerRight = footer.createDiv({ cls: 'obsidian-immich-footer-right' });

		this.insertBtn = footerRight.createEl('button', { cls: 'obsidian-immich-insert-btn' });
		this.insertBtn.setText('Insert (0)');
		this.insertBtn.disabled = true;
		this.insertBtn.style.display = 'none';
		this.insertBtn.onclick = () => this.insertSelected();

		this.multiSelectBtn = footerRight.createEl('button', { cls: 'obsidian-immich-toggle-btn' });
		this.multiSelectBtn.setText('Select multiple');
		this.multiSelectBtn.onclick = () => this.toggleMultiSelect();
	}

	private toggleMultiSelect() {
		this.multiSelect = !this.multiSelect;
		if (this.multiSelectBtn) {
			this.multiSelectBtn.toggleClass('obsidian-immich-toggle-active', this.multiSelect);
		}
		if (!this.multiSelect) {
			// clear selection when disabling
			this.selectedAssets.clear();
			this.scrollContainer?.querySelectorAll('.obsidian-immich-selected')
				.forEach(el => el.removeClass('obsidian-immich-selected'));
			this.updateInsertBtn();
		}
		if (this.insertBtn) {
			this.insertBtn.style.display = this.multiSelect ? '' : 'none';
		}
	}

	private updateInsertBtn() {
		if (!this.insertBtn) return;
		const n = this.selectedAssets.size;
		this.insertBtn.setText('Insert (' + n + ')');
		this.insertBtn.disabled = n === 0;
	}

	private insertSelected() {
		const entries = Array.from(this.selectedAssets.values());
		if (entries.length === 0) return;

		let text: string;
		if (this.settings.insertMode === 'url') {
			text = entries.map(e => buildFullUrl(e, this.settings)).join('\n') + '\n';
		} else {
			text = buildCodeblock(entries) + '\n';
		}

		this.editor.replaceSelection(text);
		this.close();
	}

	private async resetAndSearch() {
		this.currentPage = 1;
		this.hasMore = true;
		this.loadedCount = 0;
		this.selectedAssets.clear();
		if (this.multiSelect) this.updateInsertBtn();
		if (this.leftColumn) this.leftColumn.empty();
		if (this.rightColumn) this.rightColumn.empty();
		await this.fetchNextPage();
	}

	private checkAndLoadMore() {
		if (!this.scrollContainer || this.isLoading || !this.hasMore) return;
		const { scrollTop, scrollHeight, clientHeight } = this.scrollContainer;
		const pct = (scrollTop + clientHeight) / scrollHeight;
		if (pct > 0.6 || scrollHeight - (scrollTop + clientHeight) < 300) {
			this.fetchNextPage();
		}
	}

	private async fetchNextPage() {
		if (this.isLoading || !this.hasMore) return;
		this.isLoading = true;
		if (this.loadingDiv) this.loadingDiv.style.display = 'block';

		try {
			const result = await searchAssets(
				this.settings, this.query, this.isSmart,
				this.pageSize, this.dateFrom, this.dateTo, this.currentPage
			);

			if (this.countDiv) this.countDiv.setText(result.total + ' assets');
			this.hasMore = result.nextPage !== null;
			if (result.nextPage !== null) this.currentPage = result.nextPage;

			for (const asset of result.items) this.renderAsset(asset);
		} catch (e) {
			new Notice('Failed to load images — check console.');
			console.error('[Immich] Search failed:', e);
		} finally {
			this.isLoading = false;
			if (this.loadingDiv) this.loadingDiv.style.display = 'none';
		}
	}

	private renderAsset(asset: any) {
		if (!this.leftColumn || !this.rightColumn) return;

		const id: string = asset['id'];
		const type: string = asset['type'];
		if (type !== 'IMAGE' && type !== 'VIDEO') return;

		const apiKey = this.settings.immichApiKey;
		const base = this.settings.immichUrl + '/api/assets/' + id;
		const thumbUrl = base + '/thumbnail?size=thumbnail&apiKey=' + apiKey;

		const col = (this.loadedCount & 1) ? this.rightColumn : this.leftColumn;
		const wrapper = col.createDiv({ cls: 'obsidian-immich-overallDiv' });

		const img = wrapper.createEl('img');
		img.src = thumbUrl;
		img.width = (this.totalWidth / 2) - 5;
		img.style.cursor = 'pointer';

		img.onclick = () => {
			if (!this.multiSelect) {
				const entry = { id, type };
				const text = this.settings.insertMode === 'url'
					? buildFullUrl(entry, this.settings) + '\n'
					: buildCodeblock([entry]) + '\n';
				this.editor.replaceSelection(text);
				this.close();
			} else {
				if (this.selectedAssets.has(id)) {
					this.selectedAssets.delete(id);
					wrapper.removeClass('obsidian-immich-selected');
				} else {
					this.selectedAssets.set(id, { id, type });
					wrapper.addClass('obsidian-immich-selected');
				}
				this.updateInsertBtn();
			}
		};
		img.onerror = () => wrapper.setText('Failed to load');

		this.loadedCount++;
	}

	onClose() {
		if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
		if (this.searchTimeout) clearTimeout(this.searchTimeout);
		this.contentEl.empty();
	}
}

class SettingTab extends PluginSettingTab {
	plugin: ObsidianImmich;

	constructor(app: App, plugin: ObsidianImmich) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Immich URL')
			.setDesc('Full URL to your Immich instance.')
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
			.setName('Album ID (optional)')
			.setDesc('Restrict browsing and search to a specific album UUID. Leave empty to browse the full library.')
			.addText(text => text
				.setValue(this.plugin.settings.immichAlbum)
				.onChange(async (value) => {
					this.plugin.settings.immichAlbum = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Insert mode')
			.setDesc('Code block stores only the asset ID — the URL and API key are resolved from settings at render time. Full URL embeds everything directly in the note.')
			.addDropdown(drop => drop
				.addOption('codeblock', 'Code block (recommended)')
				.addOption('url', 'Full URL')
				.setValue(this.plugin.settings.insertMode)
				.onChange(async (value) => {
					this.plugin.settings.insertMode = value as 'url' | 'codeblock';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Test connection')
			.setDesc('Validate the connection and API key against your Immich instance.')
			.addButton(button => {
				button.setButtonText('Test connection');
				button.onClick(() => testConnection(this.plugin.settings));
			});
	}
}