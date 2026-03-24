import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portfolio = JSON.parse(fs.readFileSync(path.join(__dirname, 'portfolio.json'), 'utf-8'));

function parseJSON(text) {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

const RATES = {
  branding: 4500,       // 30 hours
  brandingCombo: 4000,  // discount when bundled with web
  webPerHour: 150,      // $150/hr
  hosting: 450,
  supportBasic: 1200,
  supportPremium: 1500,
};

/**
 * Find similar projects from portfolio based on sector and keywords.
 */
export function findSimilarProjects(sector, keywords = '') {
  const kw = keywords.toLowerCase().split(/\s+/).filter(Boolean);

  // Filter by sector first
  let matches = portfolio.filter(p => p.sector === sector);

  // Score by keyword match in name
  const scored = matches.map(p => {
    const nameLower = p.name.toLowerCase();
    const kwScore = kw.reduce((sum, k) => sum + (nameLower.includes(k) ? 1 : 0), 0);
    return { ...p, score: kwScore };
  });

  // Sort by keyword relevance, then random for variety
  scored.sort((a, b) => b.score - a.score || Math.random() - 0.5);

  return scored.slice(0, 6);
}

/**
 * Calculate pricing breakdown from selected services.
 */
export function buildPricingBreakdown(options) {
  const lineItems = [];
  let total = 0;

  const hasCombo = options.branding && options.webDesign;

  if (options.branding) {
    const price = hasCombo ? RATES.brandingCombo : RATES.branding;
    lineItems.push({
      service: 'Brand & Identity Package',
      detail: '30 hours',
      price,
    });
    total += price;
  }

  if (options.webDesign) {
    const hours = options.webDesignHours || 50;
    const price = hours * RATES.webPerHour;
    lineItems.push({
      service: 'Web Design & Development',
      detail: `${hours} hours`,
      price,
    });
    total += price;
  }

  if (options.hosting) {
    lineItems.push({
      service: 'Annual Hosting',
      detail: 'managed hosting',
      price: RATES.hosting,
    });
    total += RATES.hosting;
  }

  if (options.support) {
    const tier = options.supportTier || 'basic';
    const price = tier === 'premium' ? RATES.supportPremium : RATES.supportBasic;
    lineItems.push({
      service: 'Annual Support Agreement',
      detail: tier === 'premium' ? 'premium tier' : 'basic tier',
      price,
    });
    total += price;
  }

  if (options.customTotal != null) {
    return {
      lineItems,
      total: options.customTotal,
      deposit: options.customTotal * 0.5,
      customized: true,
    };
  }

  return {
    lineItems,
    total,
    deposit: total * 0.5,
    customized: false,
  };
}

/**
 * Format AI-generated content into copy-ready sections.
 */
const SCOPE_BOILERPLATE = 'As part of the process, we develop a Creative Brief outlining the audience, goals, messaging, and any obstacles to overcome based on our kick-off meeting and a Discovery Questionnaire that can be distributed to key staff and stakeholders. The Creative Brief and Site Outline becomes our guide for developing the remaining pieces outlined below in a coherent and efficient way.';

export function formatProposalSections(generated) {
  const scopeParts = [SCOPE_BOILERPLATE, ''];

  for (const s of generated.scope) {
    scopeParts.push(s.title);
    if (s.intro) scopeParts.push(s.intro);
    if (s.bullets?.length) {
      for (const b of s.bullets) {
        scopeParts.push(`• ${b}`);
      }
    }
    // Fall back to old format if description exists
    if (s.description && !s.intro && !s.bullets) {
      scopeParts.push(s.description);
    }
    if (s.note) scopeParts.push(s.note);
    scopeParts.push('');
  }

  return {
    executiveSummary: generated.executiveSummary,
    projectGoals: generated.projectGoals.map(g => `• ${g}`).join('\n'),
    scope: scopeParts.join('\n').trim(),
    timeline: generated.timeline,
    nextSteps: generated.nextSteps || '',
  };
}

/**
 * Extract client info from uploaded content using Claude.
 */
export async function extractClientInfo(content, anthropicClient) {
  const prompt = `Extract client information from the following meeting transcript, notes, or documents. Return ONLY valid JSON with these fields:

{
  "clientName": "organization/company name",
  "contactName": "primary contact person's name",
  "sector": "nonprofit" or "small-business" or "education" or "government",
  "keywords": "2-3 industry keywords separated by commas (e.g. arts, community, environment)",
  "projectType": "web-design" or "branding-web" or "branding" or "redesign",
  "notes": "1-2 sentence summary of what the client needs"
}

If a field cannot be determined, use an empty string. Make your best guess for sector and projectType based on context.

CONTENT:
${content.slice(0, 8000)}`;

  const response = await anthropicClient.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  return parseJSON(text);
}

/**
 * Generate proposal content from transcript/notes using Claude.
 */
export async function generateProposal(clientName, sector, transcript, notes, anthropicClient) {
  const prompt = `You are writing a web design/branding proposal for Third Sun Productions, a Salt Lake City web design agency specializing in nonprofits and small businesses. They use Joomla CMS for all client sites.

TONE AND STYLE RULES — THIS IS CRITICAL:
- Write in THIRD PERSON only. Never use "you" or "your." Always refer to the client by their organization name (e.g. "${clientName}") or "the client."
- Refer to Third Sun as "Third Sun Productions" or "Third Sun."
- The tone should be professional and confident, not casual. Match these examples:
  - "Third Sun Productions proposes to develop a new website for ${clientName} to create a professional online presence..."
  - "The website will be built on Joomla, an open source content management system that provides a robust and cost-effective platform..."
  - "Design a custom, mobile-friendly, and visually-appealing website that will effectively engage ${clientName}'s target audiences."
- Do NOT address the client directly. This is a formal proposal document, not a sales email.

Generate proposal content for a new client based on the following input.

CLIENT: ${clientName}
SECTOR: ${sector}

${transcript ? `ZOOM TRANSCRIPT / MEETING NOTES:\n${transcript}\n` : ''}
${notes ? `ADDITIONAL NOTES:\n${notes}\n` : ''}

Generate the following sections in JSON format:
{
  "executiveSummary": "2-3 paragraph executive summary. First paragraph: what Third Sun proposes to do for the client and why. Second paragraph: mention Joomla as the CMS platform with the standard language about it being robust, cost-effective, recently upgraded with enhanced security and accessibility tools. MUST be in third person.",
  "projectGoals": ["goal 1", "goal 2", "goal 3", "goal 4", "goal 5"],
  "scope": [
    {"title": "SECTION HEADING", "intro": "Optional intro sentence(s) before bullet points. Can be empty string.", "bullets": ["bullet point 1", "bullet point 2"], "note": "Optional closing note in italics. Can be empty string."}
  ],
  "timeline": "estimated timeline range like '6-12 weeks' or '2-4 months' — do NOT end with a period",
  "nextSteps": "A brief 2-3 sentence call to action about next steps to proceed with the project."
}

SCOPE SECTION RULES:
The scope MUST start with this exact boilerplate intro paragraph (do not include it as a scope section — it will be prepended automatically):
"As part of the process, we develop a Creative Brief outlining the audience, goals, messaging, and any obstacles to overcome based on our kick-off meeting and a Discovery Questionnaire that can be distributed to key staff and stakeholders. The Creative Brief and Site Outline becomes our guide for developing the remaining pieces outlined below in a coherent and efficient way."

Then include ONLY the relevant sections from this list, using these EXACT titles:

1. "BRAND & IDENTITY PACKAGE" — Only if branding is involved. Include:
   - intro: describe the logo concept process (2-3 concepts, mock-ups, revisions)
   - bullets: ["Logo design with style guide with color palette and typefaces", "All vector files along with web-ready files", "Business card design"]
   - note: "We can provide collateral design at additional cost (letterhead template, brochures, print ads, etc.)."

2. "CONTENT CONSULTING & STRATEGY" — Almost always included.
   - intro: describe how Third Sun will identify core marketing messages and prepare microcopy for calls to action
   - bullets: not needed, use intro only

3. "VISUAL ASSETS & PHOTOGRAPHY" — Include if photos, video, or visual assets are discussed.
   - intro: describe the visual approach (using existing branding or new, photo shoots, drone footage, etc.)
   - bullets: not needed, use intro only

4. "WEB DESIGN & DEVELOPMENT" — Almost always included.
   - intro: "Building off the branding, Third Sun will design a new website that includes the following:" (or similar)
   - bullets should include items like: custom Joomla template, content input with estimated page count, contact form, social media integration, accessibility testing, content management tools
   - note: "This estimate assumes 2 rounds of revisions for each design element. Additional revisions will be billed accordingly."

5. "HOSTING, TRAINING & SUPPORT AGREEMENT" — Include if hosting/support is in the pricing.
   - bullets: ["Provide and maintain relevant MySQL/PHP hosting for Joomla website.", "Provide administrator training for designated web contact(s) upon website launch.", "Monitor software updates for Joomla software and third party plugins.", "Provide email support to staff for questions and issues.", "Provide access to Third Sun training materials and group trainings as available."]
   - note: "Renewable annually."

Only include sections that are relevant based on the input. Tailor bullet points to the specific client.
Return ONLY valid JSON, no markdown formatting.`;

  const response = await anthropicClient.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  return parseJSON(text);
}
