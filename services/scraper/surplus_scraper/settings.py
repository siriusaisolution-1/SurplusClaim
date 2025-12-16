BOT_NAME = "surplus_scraper"

SPIDER_MODULES = ["surplus_scraper.spiders"]
NEWSPIDER_MODULE = "surplus_scraper.spiders"

ROBOTSTXT_OBEY = True

TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"

DOWNLOADER_MIDDLEWARES = {
    "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler": 543,
}

DOWNLOAD_HANDLERS = {
    "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
}

PLAYWRIGHT_BROWSER_TYPE = "chromium"
PLAYWRIGHT_LAUNCH_OPTIONS = {"headless": True}

LOG_LEVEL = "INFO"
