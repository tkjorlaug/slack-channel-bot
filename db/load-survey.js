import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function loadSurvey() {
  // Get the survey filename from the command line
  // e.g. node db/load-survey.js atlassian-feedback.json
  const filename = process.argv[2];
  if (!filename) {
    console.error('❌ Please provide a survey filename e.g. node db/load-survey.js atlassian-feedback.json');
    process.exit(1);
  }

  const filepath = path.join(__dirname, '..', 'surveys', filename);
  if (!fs.existsSync(filepath)) {
    console.error(`❌ File not found: ${filepath}`);
    process.exit(1);
  }

  const survey = JSON.parse(fs.readFileSync(filepath, 'utf8'));

  try {
    // Insert the survey
    const surveyResult = await pool.query(
      `INSERT INTO surveys (title, description, anonymous, deadline, status)
       VALUES ($1, $2, $3, $4, 'draft') RETURNING id`,
      [survey.title, survey.description, survey.anonymous, survey.deadline]
    );
    const surveyId = surveyResult.rows[0].id;
    console.log(`✅ Survey created with ID: ${surveyId}`);

    // Insert each question
    for (const q of survey.questions) {
      await pool.query(
        `INSERT INTO questions (survey_id, position, text, type, options)
         VALUES ($1, $2, $3, $4, $5)`,
        [surveyId, q.position, q.text, q.type, q.options ? JSON.stringify(q.options) : null]
      );
      console.log(`   ✅ Question ${q.position} added: "${q.text}"`);
    }

    console.log(`\n🎉 Survey "${survey.title}" loaded successfully!`);
  } catch (err) {
    console.error('❌ Failed to load survey:', err);
  } finally {
    await pool.end();
  }
}

loadSurvey();
