// Canonical list of subjects the tutor supports, grouped by category.
// Used server-side to validate the `subject` field so arbitrary text can't
// be injected into the system prompt via the API.

const SUBJECT_GROUPS = {
  "Mathematics": [
    "Arithmetic", "Pre-Algebra", "Algebra I", "Algebra II", "Geometry",
    "Trigonometry", "Pre-Calculus", "Calculus", "Statistics & Probability",
    "Linear Algebra", "Discrete Mathematics"
  ],
  "Sciences": [
    "Physics", "Chemistry", "Biology", "Earth Science", "Environmental Science",
    "Astronomy", "Anatomy & Physiology"
  ],
  "Computer Science": [
    "Programming Fundamentals", "Data Structures & Algorithms", "Web Development",
    "Databases & SQL", "Machine Learning", "Cybersecurity"
  ],
  "Languages & Literature": [
    "English Language", "English Literature", "Grammar & Composition", "Creative Writing",
    "Spanish", "French", "German", "Mandarin Chinese", "Japanese", "Arabic", "Latin",
    "Igbo", "Yoruba", "Hausa"
  ],
  "Social Studies": [
    "World History", "U.S. History", "Geography", "Civics & Government",
    "Economics", "Psychology", "Sociology", "Anthropology", "Philosophy"
  ],
  "Business & Law": [
    "Accounting", "Business Studies", "Marketing", "Finance", "Law & Legal Studies"
  ],
  "Arts": [
    "Music Theory", "Art History", "Studio Art", "Drama & Theater", "Film Studies"
  ],
  "Health & PE": [
    "Health Education", "Nutrition Science", "Physical Education"
  ],
  "Test Prep": [
    "SAT Prep", "ACT Prep", "GRE Prep", "GMAT Prep", "IELTS/TOEFL Prep", "AP Exam Prep"
  ]
};

const ALL_SUBJECTS = Object.values(SUBJECT_GROUPS).flat();

function isValidSubject(subject) {
  return typeof subject === 'string' && ALL_SUBJECTS.includes(subject);
}

module.exports = { SUBJECT_GROUPS, ALL_SUBJECTS, isValidSubject };