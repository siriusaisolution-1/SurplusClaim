import os

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

ITEM_PIPELINES = {
    "surplus_scraper.pipelines.NormalizedCaseValidationPipeline": 300,
}

FEEDS = {
    os.environ.get("SCRAPY_FEED_URI", "./output/%(name)s/%(time)s.json"): {
        "format": "json",
        "overwrite": False,
    }
}
