/**
 * Curated canonical skills, context-sensitive aliases, directional relations and role families.
 * Related technologies are not automatically equivalent; versioned rules keep matching reproducible.
 */
export const TAXONOMY_VERSION = 'rovdo-taxonomy-3' as const;
export const TAXONOMY_REFERENCES = [
  'https://www.onetcenter.org/database.html',
  'https://esco.ec.europa.eu/en/classification',
];
type SkillType =
  | 'language'
  | 'framework'
  | 'runtime'
  | 'database'
  | 'cloud'
  | 'tool'
  | 'library'
  | 'methodology';
export type Skill = {
  id: string;
  name: string;
  type: SkillType;
  aliases: { label: string; context: 'any' | 'skill' }[];
};
const seeds: [string, string, SkillType, string[]][] = [
  ['excel', 'Excel', 'tool', ['Microsoft Excel']],
  ['powerbi', 'Power BI', 'tool', ['PowerBI', 'Microsoft Power BI']],
  ['tableau', 'Tableau', 'tool', []],
  ['autocad', 'AutoCAD', 'tool', []],
  ['solidworks', 'SolidWorks', 'tool', []],
  ['gd-and-t', 'GD&T', 'methodology', ['geometric dimensioning and tolerancing']],
  ['gaap', 'GAAP', 'methodology', ['generally accepted accounting principles']],
  ['ifrs', 'IFRS', 'methodology', ['international financial reporting standards']],
  ['lean-manufacturing', 'Lean Manufacturing', 'methodology', []],
  ['six-sigma', 'Six Sigma', 'methodology', []],
  ['arcgis', 'ArcGIS', 'tool', []],
  ['revit', 'Revit', 'tool', ['Autodesk Revit']],
  ['typescript', 'TypeScript', 'language', ['ts']],
  ['javascript', 'JavaScript', 'language', ['js', 'ecmascript']],
  ['java', 'Java', 'language', []],
  ['python', 'Python', 'language', ['python3']],
  ['cpp', 'C++', 'language', ['cpp']],
  ['csharp', 'C#', 'language', ['csharp']],
  ['c', 'C', 'language', []],
  ['go', 'Go', 'language', ['golang']],
  ['r', 'R', 'language', []],
  ['rust', 'Rust', 'language', []],
  ['sql', 'SQL', 'language', []],
  ['react', 'React', 'framework', ['react.js', 'reactjs']],
  ['angular', 'Angular', 'framework', []],
  ['vue', 'Vue', 'framework', ['vue.js']],
  ['nextjs', 'Next.js', 'framework', ['nextjs']],
  ['dotnet', '.NET', 'framework', ['dotnet']],
  ['django', 'Django', 'framework', []],
  ['spring', 'Spring', 'framework', ['spring boot']],
  ['express', 'Express', 'framework', ['express.js']],
  ['nodejs', 'Node.js', 'runtime', ['node', 'nodejs']],
  ['postgresql', 'PostgreSQL', 'database', ['postgres']],
  ['mysql', 'MySQL', 'database', []],
  ['mongodb', 'MongoDB', 'database', ['mongo']],
  ['redis', 'Redis', 'database', []],
  ['aws', 'AWS', 'cloud', ['amazon web services']],
  ['azure', 'Azure', 'cloud', ['microsoft azure']],
  ['gcp', 'Google Cloud', 'cloud', ['gcp', 'google cloud platform']],
  ['docker', 'Docker', 'tool', []],
  ['kubernetes', 'Kubernetes', 'tool', ['k8s']],
  ['git', 'Git', 'tool', []],
  ['terraform', 'Terraform', 'tool', []],
  ['linux', 'Linux', 'tool', []],
  ['html', 'HTML', 'language', ['html5']],
  ['css', 'CSS', 'language', ['css3']],
  ['pytorch', 'PyTorch', 'library', []],
  ['tensorflow', 'TensorFlow', 'library', []],
  ['pandas', 'pandas', 'library', []],
  ['agile', 'Agile', 'methodology', []],
  ['verilog', 'Verilog', 'language', []],
  ['systemverilog', 'SystemVerilog', 'language', ['system verilog']],
  ['vhdl', 'VHDL', 'language', []],
  ['assembly', 'Assembly', 'language', ['assembly language']],
  ['matlab', 'MATLAB', 'language', []],
  ['tcl', 'Tcl', 'language', []],
  ['bash', 'Bash', 'language', []],
  ['cmake', 'CMake', 'tool', []],
  ['fpga', 'FPGA', 'tool', ['field programmable gate array']],
  ['asic', 'ASIC', 'tool', ['application specific integrated circuit']],
  ['riscv', 'RISC-V', 'tool', ['risc v', 'riscv']],
  ['arm', 'ARM', 'tool', ['arm cortex', 'cortex-m']],
  ['stm32', 'STM32', 'tool', []],
  ['esp32', 'ESP32', 'tool', []],
  ['arduino', 'Arduino', 'tool', []],
  ['raspberry-pi', 'Raspberry Pi', 'tool', []],
  ['freertos', 'FreeRTOS', 'runtime', ['free rtos']],
  ['zephyr', 'Zephyr RTOS', 'runtime', ['zephyr']],
  ['rtos', 'RTOS', 'runtime', ['real time operating system']],
  ['embedded-linux', 'Embedded Linux', 'runtime', []],
  ['ros', 'ROS', 'framework', ['robot operating system']],
  ['ros2', 'ROS 2', 'framework', ['ros2']],
  ['gazebo', 'Gazebo', 'tool', []],
  ['opencv', 'OpenCV', 'library', []],
  ['slam', 'SLAM', 'methodology', ['simultaneous localization and mapping']],
  ['pid-control', 'PID Control', 'methodology', ['pid controller']],
  ['spi', 'SPI', 'tool', []],
  ['i2c', 'I2C', 'tool', ['i?c']],
  ['uart', 'UART', 'tool', []],
  ['can-bus', 'CAN bus', 'tool', []],
  ['jtag', 'JTAG', 'tool', []],
  ['pcb', 'PCB Design', 'methodology', ['pcb design']],
  ['kicad', 'KiCad', 'tool', []],
  ['altium', 'Altium Designer', 'tool', ['altium']],
  ['vivado', 'Vivado', 'tool', ['xilinx vivado']],
  ['quartus', 'Quartus', 'tool', ['intel quartus']],
  ['uvm', 'UVM', 'methodology', ['universal verification methodology']],
  ['rtl', 'RTL Design', 'methodology', ['rtl design']],
  ['sta', 'Static Timing Analysis', 'methodology', []],
  ['dsp', 'Digital Signal Processing', 'methodology', []],
  ['pytest', 'pytest', 'tool', []],
  ['gtest', 'Google Test', 'tool', ['gtest']],
  ['grpc', 'gRPC', 'framework', []],
  ['rest', 'REST API', 'methodology', ['rest api']],
  ['ci-cd', 'CI/CD', 'methodology', ['ci cd']],
  ['jenkins', 'Jenkins', 'tool', []],
  ['github-actions', 'GitHub Actions', 'tool', []],
  ['swift', 'Swift', 'language', []],
  ['kotlin', 'Kotlin', 'language', []],
  ['julia', 'Julia', 'language', []],
];
const norm = (s: string) => s.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
// Ordinary words and short aliases require an explicit skill context to avoid incidental matches.
const ambiguous = new Set([
  'ts',
  'js',
  'node',
  'go',
  'r',
  'c',
  'arm',
  'ros',
  'spring',
  'express',
  'rust',
  'assembly',
  'gazebo',
  'zephyr',
  'agile',
  'swift',
  'julia',
]);
export const SKILLS: readonly Skill[] = Object.freeze(
  seeds.map(([id, name, type, aliases]) =>
    Object.freeze({
      id,
      name,
      type,
      aliases: [name, id, ...aliases].map((label) => ({
        label,
        context: ambiguous.has(norm(label)) ? ('skill' as const) : ('any' as const),
      })),
    }),
  ),
);
export function resolveSkill(value: string, context: 'any' | 'skill' = 'any'): Skill | null {
  return (
    SKILLS.find((s) =>
      s.aliases.some(
        (a) => norm(a.label) === norm(value) && (a.context === 'any' || context === 'skill'),
      ),
    ) ?? null
  );
}
// Only directional implies edges grant transferable credit; related edges document adjacency, not equivalence.
export const SKILL_RELATIONS = Object.freeze([
  { from: 'typescript', to: 'javascript', type: 'implies' as const },
  { from: 'postgresql', to: 'sql', type: 'implies' as const },
  { from: 'mysql', to: 'sql', type: 'implies' as const },
  { from: 'react', to: 'angular', type: 'related' as const },
  { from: 'aws', to: 'azure', type: 'related' as const },
]);
/** Compare canonical skill and optional version evidence using only curated directional implications. */
export function matchSkill(
  candidate: string,
  required: string,
  version: string | null = null,
  range: string | null = null,
  implicationCredit = 0.85,
) {
  if (candidate !== required) {
    const implied = SKILL_RELATIONS.some(
      (r) => r.from === candidate && r.to === required && r.type === 'implies',
    );
    return {
      strength: implied && !range ? implicationCredit : 0,
      reason: implied ? 'curated directional implication' : 'no curated equivalence',
    };
  }
  if (!range) return { strength: 1, reason: 'exact canonical skill' };
  if (!version) return { strength: 0.5, reason: 'version evidence missing' };
  const v = version.split('.').map(Number);
  const match = /^(>=|>|<=|<|\^|~|=)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
  if (!match || v.some((x) => !Number.isFinite(x)))
    return { strength: 0, reason: 'unsupported version range' };
  const parts = [Number(match[2]), Number(match[3] ?? 0), Number(match[4] ?? 0)];
  const delta = v[0]! - parts[0]! || (v[1] ?? 0) - parts[1]! || (v[2] ?? 0) - parts[2]!;
  const op = match[1] ?? '=';
  const pass =
    op === '>='
      ? delta >= 0
      : op === '>'
        ? delta > 0
        : op === '<='
          ? delta <= 0
          : op === '<'
            ? delta < 0
            : op === '^'
              ? delta >= 0 && v[0] === parts[0]
              : op === '~'
                ? delta >= 0 && v[0] === parts[0] && (v[1] ?? 0) === parts[1]
                : v.slice(0, match[4] ? 3 : match[3] ? 2 : 1).every((x, i) => x === parts[i]);
  return {
    strength: pass ? 1 : 0,
    reason: pass ? 'compatible explicit version' : 'incompatible explicit version',
  };
}
export function roleOf(title: string) {
  const t = title.toLowerCase();
  const family = /mechanical|mechanic(?:al)? design/.test(t)
    ? 'mechanical'
    : /electrical|electronics/.test(t)
      ? 'electrical'
      : /hardware|\bfpga\b|\basic\b/.test(t)
        ? 'hardware'
        : /embedded|firmware/.test(t)
          ? 'embedded'
          : /robotics|robotic /.test(t)
            ? 'robotics'
            : /civil engineer|structural engineer/.test(t)
              ? 'civil'
              : /manufactur|industrial engineer|quality engineer/.test(t)
                ? 'manufacturing'
                : /accountant|accounting|auditor|financial analyst/.test(t)
                  ? 'finance'
                  : /registered nurse|clinical nurse|nursing/.test(t)
                    ? 'healthcare'
                    : /data scientist|machine learning|\bml engineer/.test(t)
                      ? 'data-science'
                      : /security|cyber/.test(t)
                        ? 'security'
                        : /devops|site reliability|platform engineer/.test(t)
                          ? 'platform'
                          : /software|backend|frontend|full.stack|web developer|\bswe\b|engineering manager/.test(
                                t,
                              )
                            ? 'software'
                            : /data analyst|business analyst/.test(t)
                              ? 'analytics'
                              : 'unknown';
  const level = /^\s*(?:sr\.?|senior)\s+(?!living\b)/.test(t)
    ? 'senior'
    : (/^(?:staff|principal|junior|jr\.?|intern|entry|mid|lead)\b/
        .exec(t)?.[0]
        ?.replace('jr.', 'junior') ?? 'unknown');
  return {
    family,
    specialty: /backend|back.end/.test(t)
      ? 'backend'
      : /front.end|frontend/.test(t)
        ? 'frontend'
        : /full.stack/.test(t)
          ? 'fullstack'
          : '',
    level,
    track: /manager|director|\bvp\b/.test(t)
      ? ('management' as const)
      : family !== 'unknown'
        ? ('ic' as const)
        : ('unknown' as const),
  };
}
