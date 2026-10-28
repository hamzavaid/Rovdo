/** Provisional rubric-authored cases, not independently recruiter-labeled ground truth. */
import { sampleCandidate, sampleJob } from './ranking-v2';
import type { CandidateProfile } from '@rovdo/shared';
export const BENCHMARK_AS_OF = '2026-10-28';
type Judgment = {
  id: string;
  title: string;
  text: string;
  grade: 0 | 1 | 2 | 3;
  hardMismatch: boolean;
  rationale: string;
};
function candidate(
  family: string,
  title: string,
  skills: string[],
  field: string,
): CandidateProfile {
  const p = sampleCandidate(skills);
  p.preferences.roles = [title];
  p.intelligence!.experience[0] = {
    ...p.intelligence!.experience[0]!,
    title,
    roleFamily: family,
    level: 'mid',
    skills,
  };
  p.intelligence!.projects[0] = { ...p.intelligence!.projects[0]!, roleFamily: family, skills };
  p.intelligence!.education[0]!.field = field;
  return p;
}
const backend = sampleCandidate();
const mechanical = candidate(
  'mechanical',
  'Mechanical Engineer',
  ['solidworks', 'autocad', 'gd-and-t'],
  'Mechanical Engineering',
);
const analyst = candidate('analytics', 'Data Analyst', ['excel', 'sql', 'powerbi'], 'Statistics');
const accountant = candidate('finance', 'Accountant', ['excel', 'gaap', 'ifrs'], 'Accounting');
accountant.intelligence!.certifications = [
  {
    id: 'cpa',
    name: 'CPA',
    issuer: 'Fixture licensing board',
    expires: null,
    license: true,
    verified: true,
    evidenceIds: ['assertion'],
  },
];
const jobs = (cases: Judgment[]) =>
  cases.map((c) => ({
    ...c,
    job: {
      ...sampleJob(c.text),
      id: 'quality:' + c.id,
      canonicalUrl: 'https://jobs.example.com/' + c.id,
      title: c.title,
    },
  }));
const judgment = (
  id: string,
  title: string,
  text: string,
  grade: Judgment['grade'],
  rationale: string,
  hardMismatch = false,
): Judgment => ({ id, title, text, grade, rationale, hardMismatch });
export const matchingBenchmark = {
  version: 'qualification-benchmark-v1',
  labelSource: 'provisional-rubric-authored',
  recruiterValidation: 'pending',
  scenarios: [
    {
      id: 'backend',
      candidate: backend,
      jobs: jobs([
        judgment(
          'b1',
          'Backend Engineer',
          'TypeScript and Node.js required\n4 years of backend experience\nBachelor degree required',
          3,
          'Direct skills, scoped employment and completed degree',
        ),
        judgment(
          'b2',
          'Backend Engineer',
          'JavaScript or TypeScript required\nPostgreSQL preferred',
          3,
          'Explicit alternative and directly supported database',
        ),
        judgment(
          'b3',
          'Platform Engineer',
          'JavaScript and SQL required',
          2,
          'Directional implications and adjacent family',
        ),
        judgment(
          'b4',
          'Senior Backend Engineer',
          'TypeScript required\n6 years of backend experience',
          1,
          'Relevant but duration and level gaps',
        ),
        judgment(
          'b5',
          'Backend Engineer',
          'Rust and Kubernetes required',
          0,
          'Missing required stack',
        ),
        judgment(
          'b6',
          'Backend Engineer',
          'TypeScript required\nDoctorate degree required',
          0,
          'Known completed-degree level mismatch',
          true,
        ),
        judgment(
          'b7',
          'Engineering Manager',
          'TypeScript required\n8 years of management experience',
          0,
          'Individual-contributor evidence does not establish management experience',
        ),
        judgment(
          'b8',
          'Backend Engineer',
          'TypeScript required\nWork authorization: US required.',
          1,
          'Technical fit but authorization unknown',
        ),
        judgment(
          'b9',
          'Backend Engineer',
          'Skills include TypeScript. Responsibilities include maintaining services.',
          2,
          'Ambiguous requirement importance requires review',
        ),
        judgment(
          'b10',
          'Backend Engineer',
          'TypeScript required\nTypeScript required\nNode.js required',
          3,
          'Duplicate requirement must not increase importance',
        ),
      ]),
    },
    {
      id: 'mechanical',
      candidate: mechanical,
      jobs: jobs([
        judgment(
          'm1',
          'Mechanical Engineer',
          'Required Qualifications\nSolidWorks and GD&T\n3 years of mechanical experience\nBachelor in Mechanical Engineering required',
          3,
          'Direct design tools, domain work and degree',
        ),
        judgment(
          'm2',
          'Mechanical Engineer',
          'AutoCAD required\nSolidWorks preferred',
          3,
          'Direct CAD competencies',
        ),
        judgment(
          'm3',
          'Senior Mechanical Engineer',
          'SolidWorks required\n6 years of mechanical experience',
          1,
          'Duration and seniority gap',
        ),
        judgment(
          'm4',
          'Electrical Engineer',
          'MATLAB and PCB Design required',
          0,
          'Different engineering domain and competencies',
        ),
        judgment('m5', 'Backend Engineer', 'TypeScript required', 0, 'Unrelated stack and domain'),
        judgment(
          'm6',
          'Mechanical Engineer',
          'AutoCAD required\nMaster in Mechanical Engineering required',
          0,
          'Known degree-level mismatch',
          true,
        ),
        judgment(
          'm7',
          'Mechanical Engineer',
          'SolidWorks or AutoCAD required\nActive security clearance required.',
          1,
          'Technical fit; explicit clearance evidence absent',
        ),
        judgment(
          'm8',
          'Mechanical Engineer',
          'SolidWorks required\nLean manufacturing preferred',
          2,
          'Required CAD supported, optional process gap',
        ),
      ]),
    },
    {
      id: 'analytics',
      candidate: analyst,
      jobs: jobs([
        judgment(
          'a1',
          'Data Analyst',
          'Required Qualifications\nExcel, SQL and Power BI\n3 years of analytics experience',
          3,
          'Direct analysis tools and relevant duration',
        ),
        judgment(
          'a2',
          'Data Analyst',
          'SQL or PostgreSQL required\nExcel preferred',
          3,
          'Exact alternative supported',
        ),
        judgment(
          'a3',
          'Senior Data Analyst',
          'SQL required\n7 years of analytics experience',
          1,
          'Experience and seniority gaps',
        ),
        judgment(
          'a4',
          'Data Scientist',
          'Python and TensorFlow required',
          0,
          'Related data work is not ML competency',
        ),
        judgment(
          'a5',
          'Accountant',
          'GAAP and IFRS required\nCPA license required',
          0,
          'Missing accounting skills and credential',
        ),
        judgment(
          'a6',
          'Data Analyst',
          'SQL required\nBachelor in Statistics required',
          3,
          'Tools and exact degree field',
        ),
        judgment(
          'a7',
          'Data Analyst',
          'SQL required\nBachelor in Electrical Engineering required',
          0,
          'Known unrelated required degree field',
          true,
        ),
        judgment(
          'a8',
          'Data Analyst',
          'SQL required\nTableau preferred',
          2,
          'Required data skill, missing preferred visualization tool',
        ),
      ]),
    },
    {
      id: 'finance',
      candidate: accountant,
      jobs: jobs([
        judgment(
          'f1',
          'Accountant',
          'Required Qualifications\nGAAP and Excel\n3 years of accounting experience\nCPA license required',
          3,
          'Verified accounting work, tools and credential',
        ),
        judgment(
          'f2',
          'Accountant',
          'IFRS and Excel required\nBachelor in Accounting required',
          3,
          'Supported standards, tools and degree',
        ),
        judgment(
          'f3',
          'Senior Accountant',
          'GAAP required\n8 years of accounting experience',
          1,
          'Relevant work but duration/level gaps',
        ),
        judgment(
          'f4',
          'Backend Engineer',
          'TypeScript required',
          0,
          'Unrelated software requirements',
        ),
        judgment(
          'f5',
          'Accountant',
          'GAAP required\nDoctorate in Accounting required',
          0,
          'Known degree mismatch',
          true,
        ),
        judgment(
          'f6',
          'Accountant',
          'Excel required\nPMP certification required',
          1,
          'Tools supported; specific credential unknown',
        ),
        judgment(
          'f7',
          'Accountant',
          'IFRS required\nPower BI preferred',
          2,
          'Required standard supported, optional tool missing',
        ),
        judgment(
          'f8',
          'Mechanical Engineer',
          'SolidWorks required',
          0,
          'Unrelated domain and tool',
        ),
      ]),
    },
  ],
} as const;
