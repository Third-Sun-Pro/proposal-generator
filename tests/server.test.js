import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

const app = createApp({ skipAuth: true });

describe('GET /', () => {
  it('returns the main page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Proposal Generator');
  });
});

describe('GET /portfolio', () => {
  it('returns portfolio data', async () => {
    const res = await request(app).get('/portfolio');
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('sector');
  });
});

describe('POST /similar-projects', () => {
  it('returns matching projects for nonprofit arts', async () => {
    const res = await request(app)
      .post('/similar-projects')
      .send({ sector: 'nonprofit', keywords: 'arts' });
    expect(res.status).toBe(200);
    expect(res.body.projects).toBeInstanceOf(Array);
    expect(res.body.projects.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown sector', async () => {
    const res = await request(app)
      .post('/similar-projects')
      .send({ sector: 'aerospace', keywords: '' });
    expect(res.status).toBe(200);
    expect(res.body.projects).toBeInstanceOf(Array);
  });
});

describe('POST /calculate-pricing', () => {
  it('returns pricing breakdown', async () => {
    const res = await request(app)
      .post('/calculate-pricing')
      .send({
        branding: true,
        webDesign: true,
        webDesignHours: 75,
        hosting: true,
        support: true,
        supportTier: 'basic',
      });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.lineItems).toBeInstanceOf(Array);
    expect(res.body.deposit).toBe(res.body.total * 0.5);
  });
});
