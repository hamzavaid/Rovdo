import { sampleJob } from './ranking-v2';

// Regression judgments authored for this backend TypeScript candidate. Not recruiter labels,
// not a representative labor-market sample, and not used to tune preset weights.
const cases: [string, string, string, number, string][] = [
  ['01', 'Backend Engineer', 'TypeScript and Node.js required\n4 years of backend experience\nBachelor degree required', 3, 'Direct stack, role, duration and degree evidence'],
  ['02', 'Backend Engineer', 'TypeScript and PostgreSQL required\n3 years of backend experience', 3, 'Direct production evidence'],
  ['03', 'Backend Engineer', 'Node.js required\n2 years of backend experience', 3, 'Direct runtime and relevant duration'],
  ['04', 'Backend Engineer', 'JavaScript and SQL required', 2, 'Curated directional TypeScript and PostgreSQL implications'],
  ['05', 'Platform Engineer', 'TypeScript and Node.js required', 2, 'Direct stack, adjacent platform family'],
  ['06', 'Senior Backend Engineer', 'TypeScript and Node.js required\n5 years of backend experience', 2, 'One year and level gap'],
  ['07', 'Backend Engineer', 'TypeScript required\nRedis preferred', 2, 'Required skill evidenced, preferred cache absent'],
  ['08', 'Backend Engineer', 'TypeScript required\nAWS preferred', 2, 'Required stack and optional infrastructure gap'],
  ['09', 'Backend Engineer', 'Node.js and PostgreSQL required\nBachelor degree or equivalent experience required', 3, 'Runtime, database and completed degree'],
  ['10', 'Backend Engineer', 'TypeScript required\nMaster degree preferred', 2, 'Strong stack, preferred education gap'],
  ['11', 'Backend Engineer', 'Java and Spring required\n4 years of backend experience', 1, 'Relevant role but unrelated stack'],
  ['12', 'Frontend Engineer', 'React and CSS required', 0, 'No frontend technology evidence'],
  ['13', 'Data Scientist', 'Python and TensorFlow required', 0, 'Unrelated technology and role'],
  ['14', 'Security Engineer', 'Python and AWS required', 0, 'Unrelated skill and role'],
  ['15', 'Backend Engineer', 'TypeScript >=6 required\nNode.js required', 1, 'Version not established'],
  ['16', 'Backend Engineer', 'Rust required', 0, 'Unrelated required language'],
  ['17', 'Engineering Manager', 'TypeScript required\n8 years of management experience', 0, 'Management track and experience mismatch'],
  ['18', 'Backend Engineer', 'TypeScript required\nDoctorate degree required', 0, 'Explicit degree incompatibility'],
  ['19', 'Backend Engineer', 'TypeScript required\n10 years of backend experience', 1, 'Substantial relevant duration gap'],
  ['20', 'Business Analyst', 'Excel required', 0, 'Unrelated tools and role'],
];
export const comparisonFixture = { version: 'comparison-v1', labelSource: 'provisional-hand-authored', recruiterValidation: 'pending', jobs: cases.map(([id, title, text, grade, rationale]) => ({ job: { ...sampleJob(`Required Qualifications\n${text}`), id: `comparison:${id}`, title }, grade, rationale })) } as const;
