import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';
import type { Part } from '@google/genai';
import type { Page } from 'puppeteer';

import { launch, wait, printDebug } from "puppeteer-utils";

let _page: Page | null = null;
let _pendingScreenshot: string | null = null;

async function getPage(): Promise<Page> {
  if (!_page) {
    const [_, page] = await launch();
    _page = page;
  }
  return _page;
}

const gotoPage = new FunctionTool({
  name: 'goto_url',
  description: 'Navigates to a URL.',
  parameters: z.object({
    url: z.string().describe("The URL to navigate to."),
  }),
  execute: async ({ url }) => {
    const page = await getPage();
    await page.goto(url, { waitUntil: 'networkidle2' });
    await wait(2000);
    return { status: 'success', report: `Navigated to ${url}.` };
  },
});

const takeScreenshot = new FunctionTool({
  name: 'take_screenshot',
  description: 'Takes a screenshot of the current page.',
  parameters: z.object({}),
  execute: async () => {
    const page = await getPage();
    await printDebug(page);

    const buffer = await page.screenshot({ encoding: 'base64' });
    _pendingScreenshot = buffer as string;  // store for injection

    return { status: 'success', report: `Screenshot captured. Analyze the provided image.` };
  },
});


const AGENT_INSTRUCTION = `Navigates to a URL and takes a screenshot.`;
export const rootAgent = new LlmAgent({
  name: 'puppeteer_agent',
  model: 'gemini-2.5-flash',
  description: 'Navigates to a URL and takes a screenshot.',
  instruction: AGENT_INSTRUCTION,
  tools: [gotoPage, takeScreenshot],

  beforeModelCallback: async ({ request }) => {
    if (_pendingScreenshot) {
      const imagePart: Part = {
        inlineData: {
          mimeType: 'image/png',
          data: _pendingScreenshot,
        },
      };

      // Inject the image into the last content of the history (tool response)
      const lastContent = request.contents[request.contents.length - 1];
      if (lastContent?.parts) {
        lastContent.parts.push(imagePart);
      }

      _pendingScreenshot = null;
    }
    return undefined;
  },
});