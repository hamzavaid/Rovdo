import { positionedPdfFixture, zipFixture } from './profile-files';
// Hand-authored, anonymized regression labels. These are not recruiter validation.
export const stabilityImports = [
 {name:'two-column.pdf',format:'pdf',kind:'file',bytes:positionedPdfFixture([
  {text:'Technical Skills',x:40,y:740},{text:'C++, FreeRTOS, Verilog',x:40,y:720},
  {text:'Education',x:40,y:660},{text:'Example University',x:40,y:640},{text:'Bachelor in Engineering',x:40,y:620},{text:'Expected May 2027',x:40,y:600},
  {text:'Experience',x:320,y:740},{text:'Firmware Engineer | Example Devices',x:320,y:720},{text:'Jan 2021 - Dec 2023',x:320,y:700},{text:'Developed C++ drivers.',x:320,y:680},
  {text:'Projects',x:320,y:640},{text:'Servo Controller',x:320,y:620},{text:'Built Verilog modules.',x:320,y:600}]),
  skills:['cpp','freertos','verilog'],work:['Firmware Engineer','Example Devices','2021-01','2023-12'],school:['Example University','expected','2027-05'],project:'Servo Controller'},
 {name:'table-resume.docx',format:'docx',kind:'file',bytes:zipFixture({'word/document.xml':`<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Technical Skills</w:t></w:r></w:p><w:p><w:r><w:t>Python, ROS 2</w:t></w:r></w:p><w:p><w:r><w:t>Experience</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Robotics Engineer</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sample Labs | Mar 2020 - Feb 2022</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:pPr><w:numPr/></w:pPr><w:hyperlink r:id="rId1"><w:r><w:t>Built Python controls using ROS 2.</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:t>Education</w:t></w:r></w:p><w:p><w:r><w:t>Bachelor in Engineering | Example University | completed 2019</w:t></w:r></w:p><w:p><w:r><w:t>Projects</w:t></w:r></w:p><w:p><w:r><w:t>Robot Arm | Python controller</w:t></w:r></w:p></w:body></w:document>`}),
  skills:['python','ros2'],work:['Robotics Engineer','Sample Labs','2020-03','2022-02'],school:['Example University','completed','2019'],project:'Robot Arm'},
 {name:'archive.zip',format:'zip',kind:'linkedin',bytes:zipFixture({
  'Skills.csv':'Name\nTypeScript\nNode.js',
  'Positions.csv':'Company Name,Title,Started On,Finished On,Description\nExample Software,Backend Engineer,2022-03,2024-02,"Built TypeScript services, using Node.js"',
  'Education.csv':'School Name,Degree Name,Field Of Study,End Date\nExample University,Bachelor,Computer Science,2022',
  'Projects.csv':'Name,Description\nService Monitor,TypeScript monitoring',
  'Private.csv':'Gender,Birthday\nprivate,private'}),
  skills:['typescript','nodejs'],work:['Backend Engineer','Example Software','2022-03','2024-02'],school:['Example University','incomplete','2022'],project:'Service Monitor'},
] as const;
