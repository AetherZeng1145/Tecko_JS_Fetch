import router from '@system.router';
import fetch from '@system.fetch';

function Tecko(html, engine = 'Bing', url = '') {
  if (engine === 'URL') {
    console.log(`[Tecko] 尝试对URL进行通用页面解析: ${url}`);
    return parseGenericPage(html, url);
  }
  console.log(`[探针1] Tecko 开始解析 [${engine}] 的数据，HTML长度: ${html.length}`);
  try {
    switch (engine) {
      case 'Bing': return parseBingMobile(html);
      case 'Google':
        return [{ title: '适配中', url: '该搜索引擎的移动端页面正在适配', desc: '请暂时使用必应进行搜索。' }];
      default: return parseBingMobile(html);
    }
  } catch (error) {
    console.error(`Tecko 在解析 [${engine}] 时发生致命错误:`, error);
    return [{ title: 'Tecko 解析引擎崩溃', url: '无法处理返回的数据', desc: `解析过程中发生意外错误: ${error.message}` }];
  }
}

function parseBingMobile(html) {
  const results = [];
  const potentialBlocks = html.match(/<li(.*?)<\/li>/gs);
  if (!potentialBlocks || potentialBlocks.length === 0) {
    console.log(`[探针2-Bing] 页面中未找到任何 <li> 块。`);
    return [];
  }
  for (const block of potentialBlocks) {
    try {
      const titleMatch = block.match(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/s);
      if (!titleMatch) continue;
      const url = titleMatch[1];
      let title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
      const isReasonableTitle = /[\u4e00-\u9fa5]{2,}|[a-zA-Z]{5,}/.test(title);
      const isExternalLink = url.startsWith('http'  ) && !url.includes('bing.com') && !url.includes('microsoft.com');
      if (isReasonableTitle && isExternalLink) {
        let desc = '暂无描述';
        const descMatch = block.match(/<p[^>]*>(.*?)<\/p>/s);
        if (descMatch && descMatch[1]) {
          desc = descMatch[1].replace(/<[^>]*>/g, '').trim();
        }
        results.push({ title: title, url: url, desc: desc });
      }
    } catch (e) { console.error("解析单个必应结果块时出错:", e); continue; }
  }
  console.log(`[探针4-Bing] 通过通用逻辑，成功解析出 ${results.length} 条结果。`);
  return results;
}

function parseGenericPage(html, url) {
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '无标题';

  const cleanHtml = html.replace(/<script[^>]*>.*?<\/script>/gis, '').replace(/<style[^>]*>.*?<\/style>/gis, '');
  let content = cleanHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  
  if (content.length === 0) {
    content = '无法提取有效正文。';
  }

  return [{
    title: title,
    url: url,
    desc: content.substring(0, 2000) + (content.length > 2000 ? '...' : '') // 返回desc，而不是content数组
  }];
}

export default {
  data: {
    searchText: '',
    pageTitle: '',
    results: [],
    loading: true,
    historyStack: [],
    isReadingMode: false,
    titleTimer: null,
    scrollPosition: 0,
    needsScrolling: false
  },
  onDestroy() {
    if (this.titleTimer) { clearInterval(this.titleTimer); this.titleTimer = null; }
  },
  updateTitle(newTitle) {
    this.pageTitle = newTitle;
    const SCROLL_THRESHOLD = 22; 
    this.needsScrolling = newTitle.length > SCROLL_THRESHOLD;
    this.manageTitleDisplay();
  },
  manageTitleDisplay() {
    if (this.titleTimer) { clearInterval(this.titleTimer); this.titleTimer = null; }
    setTimeout(() => {
      const titleElement = this.$element('scrollingTitle');
      if (!titleElement) return;
      const containerWidth = 380;
      if (this.needsScrolling) {
        let currentLeft = containerWidth;
        this.scrollPosition = currentLeft;
        const scrollSpeed = 1;
        const veryFarLeft = -4000;
        setTimeout(() => {
          this.titleTimer = setInterval(() => {
            currentLeft -= scrollSpeed;
            if (currentLeft < veryFarLeft) { currentLeft = containerWidth; }
            this.scrollPosition = currentLeft;
          }, 30);
        }, 2000);
      } else {
        this.titleTimer = setInterval(() => {
          try {
            const textWidth = titleElement.getBoundingClientRect().width;
            if (textWidth > 0 && textWidth < containerWidth) {
              this.scrollPosition = (containerWidth - textWidth) / 2;
            } else { this.scrollPosition = 150; }
          } catch (e) { this.scrollPosition = 150; }
        }, 250);
      }
    }, 100);
  },
  onShow() {
    if (this.searchText && this.historyStack.length === 0) {
      this.updateTitle(this.searchText);
      this.fetchSearchResults(this.searchText);
    } else if (!this.searchText) {
      this.loading = false;
      this.results = [];
    }
  },
  fetchSearchResults(query) {
    this.loading = true;
    this.isReadingMode = false;
    const storage = require('@system.storage');
    storage.get({
      key: 'selected_engine',
      success: (data) => {
        const engine = (data === 'Bing' || data === 'Google') ? data : 'Bing';
        this.performSearch(query, engine);
      },
      fail: () => { this.performSearch(query, 'Bing'); }
    });
  },
  performSearch(query, engine) {
    const searchUrl = this.buildSearchUrl(query, engine);
    if (this.historyStack.length === 0) {
      this.historyStack.push({ url: searchUrl, engine: engine, title: query });
    }
    fetch.fetch({
      url: searchUrl,
      header: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36' },
      success: (response) => {
        this.parseSearchResults(response.data, engine, searchUrl);
      },
      fail: (error, code) => {
        this.loading = false;
        this.results = [{ title: '网络请求失败', url: `错误码: ${code}`, desc: `无法从服务器获取搜索结果。详情: ${error}` }];
      }
    });
  },
  buildSearchUrl(query, engine) {
    const encodedQuery = encodeURIComponent(query);
    switch(engine) {
      case 'Bing': return `https://www.bing.com/search?q=${encodedQuery}`;
      case 'Google': return `https://www.google.com/search?q=${encodedQuery}`;
      default: return `https://www.bing.com/search?q=${encodedQuery}`;
    }
  },
  parseSearchResults(data, engine, url  ) {
    try {
      const parsedResults = Tecko(data, engine, url);
      setTimeout(() => {
        this.results = parsedResults || [];
        this.loading = false;
      }, 0);
    } catch (error) {
      console.error('解析失败:', error);
      this.results = [];
      this.loading = false;
    }
  },
  handleItemClick(index) {
    if (this.isReadingMode) return;
    const targetItem = this.results[index];
    if (targetItem && targetItem.url) {
      this.loading = true;
      this.isReadingMode = true;
      this.updateTitle(targetItem.title);
      const targetUrl = targetItem.url;
      const targetEngine = 'URL';
      this.historyStack.push({ url: targetUrl, engine: targetEngine, title: targetItem.title });
      fetch.fetch({
        url: targetUrl,
        header: { 'User-agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36' },
        success: (response) => {
          this.parseSearchResults(response.data, targetEngine, targetUrl);
        },
        fail: (error, code) => {
          this.loading = false;
          this.results = [{ title: '页面加载失败', url: `错误码: ${code}`, desc: `无法加载页面内容。详情: ${error}` }];
        }
      });
    }
  },
  goBackOrReload() {
    this.historyStack.pop();
    if (this.historyStack.length > 0) {
      this.loading = true;
      const previousState = this.historyStack[this.historyStack.length - 1];
      
      if (previousState.engine !== 'URL') {
        this.isReadingMode = false;
      }
      
      this.updateTitle(previousState.title);
      fetch.fetch({
        url: previousState.url,
        header: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36' },
        success: (response) => {
          this.parseSearchResults(response.data, previousState.engine, previousState.url);
        },
        fail: (error, code) => {
          this.loading = false;
          this.results = [{ title: '返回失败', url: `错误码: ${code}`, desc: `无法重新加载上一页。详情: ${error}` }];
        }
      });
    } else {
      router.back();
    }
  },
  goBack() {
    router.back();
  }
}