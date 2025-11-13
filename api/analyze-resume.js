// API endpoint to analyze resume with AI
// This is a Vercel serverless function

import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { PDFExtract } from 'pdf.js-extract'

const PASSKEY = process.env.RESUME_PASSKEY || 'resume2025'

export const config = {
  api: {
    bodyParser: false,
  },
}

// Helper to parse multipart form data
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const buffer = Buffer.concat(chunks)
      const boundary = req.headers['content-type'].split('boundary=')[1]
      const parts = buffer.toString('binary').split(`--${boundary}`)
      
      const formData = {}
      let fileBuffer = null
      
      parts.forEach((part) => {
        if (part.includes('Content-Disposition')) {
          const nameMatch = part.match(/name="([^"]+)"/)
          const filenameMatch = part.match(/filename="([^"]+)"/)
          
          if (nameMatch) {
            const fieldName = nameMatch[1]
            
            if (filenameMatch) {
              // This is a file field
              const contentStart = part.indexOf('\r\n\r\n') + 4
              const contentEnd = part.lastIndexOf('\r\n')
              fileBuffer = Buffer.from(
                part.substring(contentStart, contentEnd),
                'binary'
              )
              formData.filename = filenameMatch[1]
            } else {
              // This is a regular field
              const contentStart = part.indexOf('\r\n\r\n') + 4
              const contentEnd = part.lastIndexOf('\r\n')
              formData[fieldName] = part
                .substring(contentStart, contentEnd)
                .trim()
            }
          }
        }
      })
      
      resolve({ formData, fileBuffer })
    })
    req.on('error', reject)
  })
}

// Extract text from PDF
async function extractPDFText(buffer) {
  const pdfExtract = new PDFExtract()
  const options = {}
  
  return new Promise((resolve, reject) => {
    pdfExtract.extractBuffer(buffer, options, (err, data) => {
      if (err) return reject(err)
      
      let text = ''
      data.pages.forEach((page) => {
        page.content.forEach((item) => {
          text += item.str + ' '
        })
        text += '\n'
      })
      
      resolve(text.trim())
    })
  })
}

// Analyze resume with GPT
async function analyzeResumeWithAI(resumeText) {
  const schema = z.object({
    student_name: z.string(),
    student_email: z.string(),
    page_count: z.enum(['1', '2', '3+']),
    presentation: z.object({
      no_errors: z.boolean(),
      links_working: z.boolean().nullable(),
      links_blue: z.boolean().nullable(),
      full_lines: z.boolean(),
      has_github_link: z.boolean(),
      has_coding_platform_link: z.boolean(),
      has_linkedin_link: z.boolean(),
      has_portfolio_link: z.boolean(),
      section_comment: z.string(),
    }),
    summary: z.object({
      concise_score: z.number().min(1).max(5).nullable(),
      problem_open_cp: z.boolean(),
      section_comment: z.string(),
    }),
    education: z.object({
      highlighted: z.boolean(),
      date_format: z.boolean(),
      section_comment: z.string(),
    }),
    skills: z.object({
      has_programming_languages: z.boolean(),
      has_software_packages: z.boolean(),
      has_problem_solving_ds: z.boolean(),
      has_soft_skills: z.boolean(),
      no_buzzwords: z.boolean(),
      section_comment: z.string(),
    }),
    projects: z.object({
      project_count: z.number().nullable(),
      categories: z.object({
        frontend: z.boolean(),
        backend: z.boolean(),
        fullstack: z.boolean(),
        aiml: z.boolean(),
        iot: z.boolean(),
        robotics: z.boolean(),
        research: z.boolean(),
        others: z.boolean(),
      }),
      others_details: z.string(),
      ai_generated: z.boolean().nullable(),
      has_project_names: z.boolean(),
      sequence_score: z.number().min(1).max(5).nullable(),
      has_links: z.boolean(),
      strong_verbs: z.boolean(),
      section_comment: z.string(),
    }),
    experience: z.object({
      has_basic_details: z.boolean(),
      has_learnings: z.boolean(),
      has_outcomes: z.boolean(),
      has_soft_skills: z.boolean(),
      strong_verbs: z.boolean(),
      description_score: z.number().min(1).max(5).nullable(),
      section_comment: z.string(),
    }),
    achievements: z.object({
      mentions_cp: z.boolean(),
      mentions_opensource: z.boolean(),
      mentions_competitions: z.boolean(),
      mentions_volunteering: z.boolean(),
      mentions_other: z.boolean(),
      overall_score: z.number().min(1).max(5).nullable(),
      section_comment: z.string(),
    }),
    certs: z.object({
      has_basic_info: z.boolean(),
      links_work: z.boolean().nullable(),
      section_comment: z.string(),
    }),
    overall: z.number().min(1).max(10).nullable(),
    status: z.enum(['request_changes', 'approved']),
    comments: z.string(),
  })

  const prompt = `You are a resume reviewer. Analyze this resume and provide structured feedback.

Resume text:
${resumeText}

Analyze the resume thoroughly and provide feedback for each section:

1. **Presentation**: Check for grammar/spelling errors, formatting, and presence of important links (GitHub, LeetCode/Codeforces, LinkedIn, Portfolio). Note that these resumes are generated by our platform and do not include phone numbers or addresses.
2. **Summary**: Rate conciseness (1-5), check if it mentions problem-solving/open source/competitive programming
3. **Education**: Check if college/CGPA/year are highlighted, date format consistency
4. **Skills**: Verify presence of programming languages, software packages, problem-solving/DS&A, soft skills, and absence of buzzwords
5. **Projects**: Count projects, categorize them (frontend/backend/fullstack/AI-ML/IoT/robotics/research/others), check if descriptions follow problem->solution->features sequence, verify links and strong action verbs, assess if AI-generated
6. **Experience**: Check for basic details, learnings, outcomes/impact, soft skills, strong verbs, rate description quality (1-5)
7. **Achievements**: Check mentions of competitive programming, open source, competitions/hackathons, volunteering, other achievements, rate overall (1-5)
8. **Certificates**: Check if basic info is present
9. **Overall**: Rate overall impression (1-10) and provide comprehensive feedback. this score should be populated in 'overall' field as a number.

For fields you cannot verify from text (like link colors, whether links work), set to null.
Provide specific, actionable feedback in section_comment fields.
Wherever you provide subjective feedback, do not use any symbols like →, arrows or emojis. keep it plain text. keep it point wise like markdown unordered list. However, if there are any symbols used in resume like bullet symbols, we can keep them. No need to suggest changing them.
As you cannot check the links, do not assume they work or are blue. Do not provide feedback on link colors or functionality. Simply state they are not present if they are not. Presence means existence of words like "GitHub", "LinkedIn", "Demo", "Codeforces", etc in header and project section beside project name. I will verify the links myself. 
for any changes that you suggest, always provide specifics with "what to change" and "what to write instead".
Set status to "request_changes" if improvements needed, "approved" if excellent.`

  const { object } = await generateObject({
    model: openai('gpt-5'),
    schema: schema,
    prompt: prompt,
  })

  return object
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      errorType: 'METHOD_NOT_ALLOWED',
      message: 'Only POST requests are supported'
    })
  }

  try {
    // Parse form data
    const { formData, fileBuffer } = await parseFormData(req)

    // Verify passkey
    if (!formData.passkey || formData.passkey !== PASSKEY) {
      return res.status(401).json({ 
        error: 'Invalid passkey',
        errorType: 'INVALID_PASSKEY',
        message: 'The provided passkey is incorrect. Please contact admin for access.'
      })
    }

    // Validate file
    if (!fileBuffer || !formData.filename) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        errorType: 'NO_FILE',
        message: 'Please select a PDF file to upload'
      })
    }

    if (!formData.filename.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ 
        error: 'Only PDF files are allowed',
        errorType: 'INVALID_FILE_TYPE',
        message: 'Please upload a PDF file. Other file types are not supported.'
      })
    }

    if (fileBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ 
        error: 'File size must be less than 5MB',
        errorType: 'FILE_TOO_LARGE',
        message: 'File size exceeds 5MB limit. Please upload a smaller file.'
      })
    }

    // Extract text from PDF
    let resumeText
    try {
      resumeText = await extractPDFText(fileBuffer)
    } catch (pdfError) {
      console.error('PDF extraction error:', pdfError)
      return res.status(400).json({
        error: 'Failed to extract text from PDF',
        errorType: 'PDF_EXTRACTION_FAILED',
        message: 'Unable to read the PDF file. The file may be corrupted or password-protected.'
      })
    }

    if (!resumeText || resumeText.length < 100) {
      return res.status(400).json({ 
        error: 'Could not extract text from PDF or text too short',
        errorType: 'INSUFFICIENT_TEXT',
        message: 'The PDF appears to be empty or contains insufficient text to analyze. Please ensure the resume has readable text content.'
      })
    }

    // Analyze with AI
    let analysis
    try {
      analysis = await analyzeResumeWithAI(resumeText)
    } catch (aiError) {
      console.error('AI analysis error:', aiError)
      
      // Check for specific AI errors
      if (aiError.message?.includes('API key')) {
        return res.status(500).json({
          error: 'AI service configuration error',
          errorType: 'AI_CONFIG_ERROR',
          message: 'The AI analysis service is not properly configured. Please contact the administrator.'
        })
      }
      
      if (aiError.message?.includes('rate limit')) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          errorType: 'RATE_LIMIT',
          message: 'Too many requests. Please try again in a few minutes.'
        })
      }
      
      return res.status(500).json({
        error: 'AI analysis failed',
        errorType: 'AI_ANALYSIS_FAILED',
        message: 'Failed to analyze the resume. Please try again or contact support if the issue persists.'
      })
    }

    // Merge with provided data
    if (formData.student_name && !analysis.student_name) {
      analysis.student_name = formData.student_name
    }
    if (formData.student_email && !analysis.student_email) {
      analysis.student_email = formData.student_email
    }

    // Return analysis
    return res.status(200).json({
      success: true,
      form: analysis,
      message: 'Resume analyzed successfully',
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return res.status(500).json({
      error: 'Internal server error',
      errorType: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
