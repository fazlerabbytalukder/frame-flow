const { ipcMain } = require('electron');

const storage = require('../services/storage');
const transcribeService = require('../services/transcribe-service');

// Local transcription jobs, one per project. The renderer starts a job and
// polls its status; the finished words go into the project document from the
// renderer (one undo step), so this module never writes project.json.

const LANGUAGES = ['auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'ru', 'uk', 'hi', 'bn', 'ur', 'ar', 'zh', 'ja', 'ko', 'id', 'vi', 'th'];
const jobs = new Map(); // projectId -> { state, progress, result, error }

function startJob(projectId, language, file = storage.screenMediaPath(projectId)) {
  const job = { state: 'running', progress: 0, result: null, error: null };
  jobs.set(projectId, job);
  transcribeService
    .transcribeFile(file, {
      language: language === 'auto' ? null : language,
      onProgress: (p) => (job.progress = p),
    })
    .then((result) => {
      job.state = 'done';
      job.progress = 1;
      job.result = { ...result, language: language === 'auto' ? result.language : language };
    })
    .catch((err) => {
      job.state = 'error';
      job.error = String(err && err.message ? err.message : err).slice(0, 400);
    });
  return job;
}

function registerTranscriptIpc() {
  ipcMain.handle('transcript:available', async () => transcribeService.modelAvailable());

  ipcMain.handle('transcript:start', async (event, projectId, language = 'auto') => {
    storage.assertProjectId(projectId);
    if (!LANGUAGES.includes(language)) throw new Error('Unsupported language');
    const current = jobs.get(projectId);
    if (current && current.state === 'running') return { state: 'running', progress: current.progress };
    startJob(projectId, language);
    return { state: 'running', progress: 0 };
  });

  // { state: 'idle' | 'running' | 'done' | 'error', progress, result?, error? }.
  // A finished result is handed over once, then the job is forgotten.
  ipcMain.handle('transcript:status', async (event, projectId) => {
    storage.assertProjectId(projectId);
    const job = jobs.get(projectId);
    if (!job) return { state: 'idle', progress: 0 };
    if (job.state !== 'running') jobs.delete(projectId);
    return { state: job.state, progress: job.progress, result: job.result, error: job.error };
  });
}

module.exports = { registerTranscriptIpc, startJob, LANGUAGES };
