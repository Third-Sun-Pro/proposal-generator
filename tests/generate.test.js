import { describe, it, expect } from 'vitest';
import { findSimilarProjects, buildPricingBreakdown, formatProposalSections } from '../generate.js';

describe('findSimilarProjects', () => {
  it('returns nonprofits when sector is nonprofit', () => {
    const results = findSimilarProjects('nonprofit', 'arts');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.sector).toBe('nonprofit'));
  });

  it('returns small businesses when sector is small-business', () => {
    const results = findSimilarProjects('small-business', 'food');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.sector).toBe('small-business'));
  });

  it('returns max 6 results', () => {
    const results = findSimilarProjects('nonprofit', '');
    expect(results.length).toBeLessThanOrEqual(6);
  });

  it('prioritizes keyword matches in name', () => {
    const results = findSimilarProjects('nonprofit', 'arts');
    const names = results.map(r => r.name.toLowerCase());
    const hasArtsMatch = names.some(n => n.includes('art'));
    expect(hasArtsMatch).toBe(true);
  });
});

describe('buildPricingBreakdown', () => {
  it('calculates total from selected services', () => {
    const pricing = buildPricingBreakdown({
      branding: true,
      webDesign: true,
      webDesignHours: 50,
      hosting: true,
      support: true,
      supportTier: 'basic',
    });
    // branding $4000 (combo) + web $7500 + hosting $450 + support $1200 = $13150
    expect(pricing.total).toBe(13150);
    expect(pricing.lineItems.length).toBe(4);
  });

  it('calculates web design price based on hours', () => {
    const pricing = buildPricingBreakdown({
      branding: false,
      webDesign: true,
      webDesignHours: 100,
      hosting: false,
      support: false,
    });
    expect(pricing.total).toBe(15000);
  });

  it('applies combo discount for branding + web', () => {
    const withBoth = buildPricingBreakdown({
      branding: true,
      webDesign: true,
      webDesignHours: 50,
      hosting: false,
      support: false,
    });
    const brandingOnly = buildPricingBreakdown({
      branding: true,
      webDesign: false,
      hosting: false,
      support: false,
    });
    const webOnly = buildPricingBreakdown({
      branding: false,
      webDesign: true,
      webDesignHours: 50,
      hosting: false,
      support: false,
    });
    // Combo should be less than sum of individual
    expect(withBoth.total).toBeLessThan(brandingOnly.total + webOnly.total);
  });

  it('uses premium support tier pricing', () => {
    const basic = buildPricingBreakdown({
      branding: false,
      webDesign: false,
      hosting: false,
      support: true,
      supportTier: 'basic',
    });
    const premium = buildPricingBreakdown({
      branding: false,
      webDesign: false,
      hosting: false,
      support: true,
      supportTier: 'premium',
    });
    expect(basic.total).toBe(1200);
    expect(premium.total).toBe(1500);
  });

  it('allows custom price override', () => {
    const pricing = buildPricingBreakdown({
      branding: true,
      webDesign: true,
      webDesignHours: 50,
      hosting: true,
      support: true,
      supportTier: 'basic',
      customTotal: 12000,
    });
    expect(pricing.total).toBe(12000);
    expect(pricing.customized).toBe(true);
  });
});

describe('formatProposalSections', () => {
  const sampleGenerated = {
    executiveSummary: 'We propose to build a website.',
    projectGoals: ['Goal one', 'Goal two', 'Goal three'],
    scope: [
      { title: 'CONTENT CONSULTING & STRATEGY', intro: 'We will consult on messaging.', bullets: [], note: '' },
      { title: 'WEB DESIGN & DEVELOPMENT', intro: 'Third Sun will design a new website:', bullets: ['Custom Joomla template', 'Contact form'], note: 'This estimate assumes 2 rounds of revisions.' },
    ],
    timeline: '6-12 weeks',
    nextSteps: 'Sign the agreement and submit deposit to begin.',
  };

  it('formats executive summary as plain text', () => {
    const sections = formatProposalSections(sampleGenerated);
    expect(sections.executiveSummary).toBe('We propose to build a website.');
  });

  it('formats project goals as bullet list', () => {
    const sections = formatProposalSections(sampleGenerated);
    expect(sections.projectGoals).toContain('• Goal one');
    expect(sections.projectGoals).toContain('• Goal two');
  });

  it('formats scope with boilerplate, titles, and bullets', () => {
    const sections = formatProposalSections(sampleGenerated);
    expect(sections.scope).toContain('Creative Brief');
    expect(sections.scope).toContain('CONTENT CONSULTING & STRATEGY');
    expect(sections.scope).toContain('WEB DESIGN & DEVELOPMENT');
    expect(sections.scope).toContain('• Custom Joomla template');
    expect(sections.scope).toContain('2 rounds of revisions');
  });

  it('includes timeline', () => {
    const sections = formatProposalSections(sampleGenerated);
    expect(sections.timeline).toBe('6-12 weeks');
  });

  it('includes next steps', () => {
    const sections = formatProposalSections(sampleGenerated);
    expect(sections.nextSteps).toContain('Sign the agreement');
  });
});
