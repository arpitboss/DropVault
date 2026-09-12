const request = require('supertest');
const app = require('../src/app');

describe('UI Static Assets & Web Pages (V0-T12)', () => {
  it('GET / should serve index.html with 200 OK and valid HTML structure', async () => {
    const res = await request(app).get('/');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('DropVault');
    expect(res.text).toContain('AES-256-GCM');
    expect(res.text).toContain('dropzone');
    expect(res.text).toContain('secretText');
    expect(res.text).toContain('btnCreateVault');
  });

  it('GET /index.html should serve index.html directly', async () => {
    const res = await request(app).get('/index.html');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('DropVault');
  });

  it('GET /access.html should serve access.html with 200 OK and retrieval form', async () => {
    const res = await request(app).get('/access.html');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Decrypt & Retrieve');
    expect(res.text).toContain('tokenInput');
    expect(res.text).toContain('btnRetrieve');
  });

  it('GET /style.css should serve the developer-grade stylesheet with 200 OK', async () => {
    const res = await request(app).get('/style.css');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
    expect(res.text).toContain('--bg-main');
    expect(res.text).toContain('--font-mono');
  });

  it('GET /nonexistent-file.xyz should return 404 Not Found', async () => {
    const res = await request(app).get('/nonexistent-file.xyz');

    expect(res.statusCode).toBe(404);
  });
});
