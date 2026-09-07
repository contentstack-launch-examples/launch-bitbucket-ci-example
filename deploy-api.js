try {
  require('dotenv').config();
} catch (e) {}

const fs = require('fs');
const path = require('path');
const https = require('https');
const FormData = require('form-data');

const CLIENT_ID = process.env.CONTENTSTACK_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.CONTENTSTACK_CLIENT_SECRET?.trim();
const PROJECT_UID = process.env.PROJECT_UID?.trim();
const ENVIRONMENT_UID = process.env.ENVIRONMENT_UID?.trim();

const REGION_URLS = {
  AWS_NA:     { auth: 'app.contentstack.com',                launch: 'launch-api.contentstack.com' },
  AWS_EU:     { auth: 'eu-app.contentstack.com',              launch: 'eu-launch-api.contentstack.com' },
  AWS_AU:     { auth: 'au-app.contentstack.com',              launch: 'au-launch-api.contentstack.com' },
  AZURE_NA:   { auth: 'azure-na-app.contentstack.com',        launch: 'azure-na-launch-api.contentstack.com' },
  AZURE_EU:   { auth: 'azure-eu-app.contentstack.com',        launch: 'azure-eu-launch-api.contentstack.com' },
  GCP_NA:     { auth: 'gcp-na-app.contentstack.com',          launch: 'gcp-na-launch-api.contentstack.com' },
  GCP_EU:     { auth: 'gcp-eu-app.contentstack.com',          launch: 'gcp-eu-launch-api.contentstack.com' }
};

const CONTENTSTACK_REGION = (process.env.CONTENTSTACK_REGION || '').trim().toUpperCase();
const regionConfig = CONTENTSTACK_REGION ? REGION_URLS[CONTENTSTACK_REGION] : null;

async function getM2MAccessToken() {
  return new Promise((resolve, reject) => {
    const body = `scopes=${encodeURIComponent('launch:manage')}&grant_type=${encodeURIComponent('client_credentials')}&client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}`;

    const req = https.request({
      hostname: regionConfig.auth,
      path: '/apps-api/apps/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.access_token) {
            resolve({
              token: parsed.access_token,
              organizationUid: parsed.organization_uid || null
            });
            return;
          }
          if (res.statusCode === 401) {
            console.error('Unauthorized - check credentials');
          }
          if (data && res.statusCode === 400) {
            try {
              const err = typeof data === 'string' ? JSON.parse(data) : data;
              const msg = err.error_description || err.error || err.message || data;
              console.error('Token API response:', msg);
            } catch (_) {
              console.error('Token API response body:', data);
            }
          }
          reject(new Error(`Token request failed: ${res.statusCode}`));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function launchApiRequest(apiPath, method, body, accessToken, organizationUid) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-cs-api-version': '1.0',
      'Accept': 'application/json'
    };
    if (organizationUid) {
      headers['organization_uid'] = organizationUid;
    }

    const req = https.request({
      hostname: regionConfig.launch,
      path: apiPath,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }
          if (res.statusCode === 401) {
            console.error('Launch API authentication failed');
          }
          reject(new Error(`API Error ${res.statusCode}`));
        } catch (e) {
          if (data.includes('<?xml') || data.includes('<Error>')) {
            console.error('Invalid API endpoint - check CONTENTSTACK_REGION');
          }
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function getSignedUploadUrl(tokenData) {
  const accessToken = typeof tokenData === 'string' ? tokenData : tokenData.token;
  const orgUid = typeof tokenData === 'object' ? tokenData.organizationUid : null;
  return await launchApiRequest('/projects/upload/signed_url', 'GET', null, accessToken, orgUid);
}

async function uploadZipToSignedUrl(signedUrlData, zipPath) {
  return new Promise((resolve, reject) => {
    const uploadUrl = signedUrlData.uploadUrl;
    if (!uploadUrl) {
      reject(new Error('No uploadUrl in signed URL response'));
      return;
    }

    const method = signedUrlData.method;

    let responseHeaders = {};
    const headersRaw = signedUrlData.headers;
    if (Array.isArray(headersRaw)) {
      for (const header of headersRaw) {
        const k = header.key != null ? String(header.key).trim() : '';
        const v = header.value != null ? String(header.value).trim() : '';
        if (k && v) {
          responseHeaders[header.key] = header.value;
        }
      }
    } else if (headersRaw && typeof headersRaw === 'object') {
      responseHeaders = headersRaw;
    }

    let formFields = {};
    const formFieldsRaw = signedUrlData.fields;
    if (Array.isArray(formFieldsRaw)) {
      for (const field of formFieldsRaw) {
        if (field.formFieldKey !== undefined && field.formFieldValue !== undefined) {
          formFields[field.formFieldKey] = field.formFieldValue;
        } else if (field.key !== undefined && field.value !== undefined) {
          formFields[field.key] = field.value;
        }
      }
    } else if (formFieldsRaw && typeof formFieldsRaw === 'object') {
      formFields = formFieldsRaw;
    }

    const url = new URL(uploadUrl);
    const fileSize = fs.statSync(zipPath).size;
    const hasFormFields = Object.keys(formFields).length > 0;

    if (hasFormFields) {
      const form = new FormData();
      
      for (const [key, value] of Object.entries(formFields)) {
        form.append(key, value);
      }
      
      form.append('file', fs.createReadStream(zipPath), {
        filename: 'deployment.zip',
        contentType: 'application/zip'
      });

      const formHeaders = form.getHeaders();
      
      form.getLength((err, length) => {
        if (err) {
          reject(new Error(`Failed to calculate form-data length: ${err.message}`));
          return;
        }

        const headers = { ...responseHeaders, ...formHeaders, 'Content-Length': length };

        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method,
          headers
        }, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            let errorData = '';
            res.on('data', chunk => errorData += chunk);
            res.on('end', () => {
              const errorMsg = `Upload failed: ${res.statusCode}`;
              if (errorData) {
                reject(new Error(`${errorMsg} - ${errorData}`));
              } else {
                reject(new Error(errorMsg));
              }
            });
          }
        });

        req.on('error', reject);
        form.pipe(req);
      });
    } else {
      const headers = { ...responseHeaders };
      if (headers['Content-Length'] === undefined) {
        headers['Content-Length'] = fileSize;
      }
      if (headers['Content-Type'] === undefined) {
        headers['Content-Type'] = 'application/zip';
      }

      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers
      }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          let errorData = '';
          res.on('data', chunk => errorData += chunk);
          res.on('end', () => {
            const errorMsg = `Upload failed: ${res.statusCode}`;
            if (errorData) {
              reject(new Error(`${errorMsg} - ${errorData}`));
            } else {
              reject(new Error(errorMsg));
            }
          });
        }
      });

      req.on('error', reject);
      fs.createReadStream(zipPath).pipe(req);
    }
  });
}

async function createDeployment(uploadUid, tokenData) {
  const apiPath = `/projects/${encodeURIComponent(PROJECT_UID)}/environments/${encodeURIComponent(ENVIRONMENT_UID)}/deployments`;
  const body = { uploadUid };
  const accessToken = typeof tokenData === 'string' ? tokenData : tokenData.token;
  const orgUid = typeof tokenData === 'object' ? tokenData.organizationUid : null;
  return await launchApiRequest(apiPath, 'POST', body, accessToken, orgUid);
}

// The whole project is added to the deployment zip except the entries below.
// Excluding is safer than listing what to include: a new folder is deployed by
// default, so forgetting to list it cannot silently break the Launch build.

// Skipped at every level: dependencies, local build output and VCS metadata.
const EXCLUDE_ANYWHERE = ['node_modules', '.git', '.next', 'dist', 'build', 'out', '.DS_Store'];

// Skipped only at the project root: CI and tooling files Launch does not need.
const EXCLUDE_AT_ROOT = ['deploy-api.js', 'bitbucket-pipelines.yml', 'deployment.zip', '.gitignore'];

function isExcluded(name, isRoot) {
  if (EXCLUDE_ANYWHERE.includes(name)) return true;
  if (isRoot && EXCLUDE_AT_ROOT.includes(name)) return true;
  // Never upload credentials. .env.example holds only placeholders, so it stays.
  if (name.startsWith('.env') && name !== '.env.example') return true;
  return false;
}

function addDirectoryToArchive(archive, dirPath, basePath, fileCount, isRoot = false) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    if (isExcluded(file, isRoot)) continue;
    const fullPath = path.join(dirPath, file);
    const relativePath = basePath ? path.join(basePath, file) : file;
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      addDirectoryToArchive(archive, fullPath, relativePath, fileCount);
    } else {
      archive.file(fullPath, { name: relativePath });
      fileCount.count++;
    }
  }
  return fileCount;
}

function createZipFile(outputPath) {
  return new Promise((resolve, reject) => {
    const archiver = require('archiver');
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const fileCount = { count: 0 };

    output.on('close', () => resolve());

    archive.on('error', reject);
    archive.pipe(output);

    addDirectoryToArchive(archive, process.cwd(), '', fileCount, true);

    archive.finalize();
  });
}

async function deploy() {
  const missing = [];
  if (!CLIENT_ID) missing.push('CONTENTSTACK_CLIENT_ID');
  if (!CLIENT_SECRET) missing.push('CONTENTSTACK_CLIENT_SECRET');
  if (!PROJECT_UID) missing.push('PROJECT_UID');
  if (!ENVIRONMENT_UID) missing.push('ENVIRONMENT_UID');
  if (!CONTENTSTACK_REGION) {
    missing.push('CONTENTSTACK_REGION');
  } else if (!regionConfig) {
    console.error('Unknown CONTENTSTACK_REGION:', CONTENTSTACK_REGION);
    console.error('Use one of:', Object.keys(REGION_URLS).join(', '));
    process.exit(1);
  }

  if (missing.length > 0) {
    console.error('Missing:', missing.join(', '));
    process.exit(1);
  }

  const zipPath = path.join(process.cwd(), 'deployment.zip');

  try {
    const tokenData = await getM2MAccessToken();
    await createZipFile(zipPath);

    const signedUrlData = await getSignedUploadUrl(tokenData);
    const uploadUrl = signedUrlData.uploadUrl;
    const uploadUid = signedUrlData.uploadUid;
    if (!uploadUrl || !uploadUid) {
      throw new Error('Missing uploadUrl or uploadUid in response');
    }

    await uploadZipToSignedUrl(signedUrlData, zipPath);
    await createDeployment(uploadUid, tokenData);

    fs.unlinkSync(zipPath);
  } catch (error) {
    console.error(`\nDeployment failed: ${error.message}`);
    if (error.message.includes('401') || error.message.includes('invalid')) {
      console.error('Check M2M app has Launch API permissions');
    }
    if (error.message.includes('Missing')) {
      console.error('Check environment variables');
    }
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.error('Verify PROJECT_UID and ENVIRONMENT_UID');
    }
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    process.exit(1);
  }
}

deploy();
