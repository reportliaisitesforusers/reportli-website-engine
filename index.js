/**
 * REPORTLI AI - WEBSITE BUILDER WORKER
 *
 * FLOW:
 * 1. Receive company information through POST.
 * 2. Generate WEBSITE_DATA using Sarvam AI.
 * 3. Fetch the master HTML template from GitHub.
 * 4. Replace the WEBSITE_DATA placeholder.
 * 5. Save the generated HTML to GitHub.
 * 6. Return the website ID and GitHub path.
 *
 * NO SUPABASE REQUIRED.
 */

const SARVAM_URL =
  "https://api.sarvam.ai/v1/chat/completions";

const GITHUB_API =
  "https://api.github.com";

const MAX_CONTENT_LENGTH = 30000;


// ==========================================
// MAIN WORKER
// ==========================================

export default {
  async fetch(request, env) {

    // CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({
        success: false,
        error: "Only POST requests are supported."
      }, 405);
    }

    try {

      // Check required configuration
      const required = [
        "SARVAM_API_KEY",
        "GITHUB_TOKEN",
        "GITHUB_OWNER",
        "GITHUB_REPO"
      ];

      for (const key of required) {
        if (!env[key]) {
          throw new Error(
            `Missing Worker configuration: ${key}`
          );
        }
      }

      // ======================================
      // STEP 1: RECEIVE FRONTEND CONTENT
      // ======================================

      const body = await request.json();

      const content =
        typeof body.content === "string"
          ? body.content.trim()
          : "";

      if (!content) {
        return jsonResponse({
          success: false,
          error: "Company content is required."
        }, 400);
      }

      if (content.length > MAX_CONTENT_LENGTH) {
        return jsonResponse({
          success: false,
          error: "Company content is too long."
        }, 413);
      }

      // Generate unique website ID
      const websiteId = crypto.randomUUID();

      console.log(
        "Starting website generation:",
        websiteId
      );


      // ======================================
      // STEP 2: GENERATE WEBSITE DATA
      // ======================================

      const websiteData = await generateWebsiteData(
        content,
        env.SARVAM_API_KEY
      );

      // Validate and normalize generated data
      const validatedData = validateWebsiteData(
        websiteData
      );


      // ======================================
      // STEP 3: FETCH MASTER HTML TEMPLATE
      // ======================================

      const owner = env.GITHUB_OWNER;
      const repo = env.GITHUB_REPO;
      const branch = env.GITHUB_BRANCH || "main";

      const templatePath = "template/index.html";

      const templateUrl =
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${templatePath}?ref=${encodeURIComponent(branch)}`;

      const templateResponse = await fetch(
        templateUrl,
        {
          headers: githubHeaders(env.GITHUB_TOKEN)
        }
      );

      if (!templateResponse.ok) {
        const errorText = await templateResponse.text();

        throw new Error(
          `Could not fetch template from GitHub: ${errorText}`
        );
      }

      const templateFile =
        await templateResponse.json();

      if (!templateFile.content) {
        throw new Error(
          "GitHub template file is empty."
        );
      }

      const html = decodeBase64(
        templateFile.content
      );


      // ======================================
      // STEP 4: INSERT GENERATED WEBSITE DATA
      // ======================================

      const placeholder =
        "const WEBSITE_DATA = __WEBSITE_DATA_JSON__;";

      if (!html.includes(placeholder)) {
        throw new Error(
          "WEBSITE_DATA placeholder not found in template/index.html. Check your template."
        );
      }

      // Prevent closing-script injection
      const safeJSON = JSON.stringify(
        validatedData
      ).replace(/</g, "\\u003c");

      const generatedHTML = html.replace(
        placeholder,
        `const WEBSITE_DATA = ${safeJSON};`
      );

      if (generatedHTML.includes("__WEBSITE_DATA_JSON__")) {
        throw new Error(
          "Website data placeholder was not completely replaced."
        );
      }


      // ======================================
      // STEP 5: SAVE GENERATED HTML TO GITHUB
      // ======================================

      const githubPath =
        `customers/${websiteId}/index.html`;

      const saveUrl =
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${githubPath}`;

      // Convert HTML to Base64 safely
      const encodedHTML = encodeBase64(
        generatedHTML
      );

      const saveResponse = await fetch(
        saveUrl,
        {
          method: "PUT",

          headers: {
            ...githubHeaders(env.GITHUB_TOKEN),
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            message:
              `Generate website ${websiteId}`,

            content: encodedHTML,

            branch: branch
          })
        }
      );

      const saveResult = await saveResponse.json();

      if (!saveResponse.ok) {
        throw new Error(
          `GitHub save failed: ${JSON.stringify(saveResult)}`
        );
      }


      // ======================================
      // STEP 6: SUCCESS RESPONSE
      // ======================================

      return jsonResponse({

        success: true,

        message: "Website generated successfully.",

        website_id: websiteId,

        github_path: githubPath,

        github_url:
          saveResult.content?.html_url || null,

        website_data: validatedData

      }, 200);

    } catch (error) {

      console.error(
        "Website Builder Error:",
        error.message
      );

      return jsonResponse({

        success: false,

        error: error.message || "Website generation failed."

      }, 500);
    }
  }
};


// ==========================================
// SARVAM AI WEBSITE GENERATION
// ==========================================

async function generateWebsiteData(
  companyContent,
  apiKey
) {

  const systemPrompt = `
You are Reportli AI's professional website content generator.

Your job is to transform a company's information into
a complete WEBSITE_DATA JSON object for a professional
creator-business website.

IMPORTANT RULES:

1. Return ONLY valid JSON.
2. Do not return HTML, CSS, JavaScript or Markdown.
3. Use the exact JSON structure provided below.
4. Write persuasive, professional and natural website copy.
5. Understand the business before generating content.
6. Never invent testimonials, customer names, results,
   revenue figures, qualifications or achievements.
7. If real testimonials are not supplied, return [].
8. If real results are not supplied, return [].
9. Never invent a contact email or social media URL.
10. If information is missing, use an empty string or [].
11. Do not invent prices. Use an empty string if unknown.
12. Do not invent services that contradict the company
    description.
13. Keep copy concise and suitable for a real website.
14. Make the website specific to the company's audience.
15. Use appropriate professional brand colors.
16. Do not add explanations outside the JSON.

REQUIRED JSON STRUCTURE:

{
  "business_name": "",
  "creator_name": "",
  "business_description": "",
  "target_audience": "",

  "expertise": [],

  "hero_headline": "",
  "hero_description": "",

  "primary_cta_text": "",
  "primary_cta_link": "",

  "secondary_cta_text": "",
  "secondary_cta_link": "",

  "about_title": "",
  "about_description": "",

  "offers": [],

  "benefits": [],

  "testimonials": [],

  "results": [],

  "courses": [],

  "contact_email": "",

  "social_links": [],

  "brand_colors": {
    "primary": "#111111",
    "accent": "#D6FF00",
    "background": "#FFFFFF",
    "text": "#111111"
  },

  "form_endpoint": "",

  "section_titles": {}
}

ARRAY STRUCTURES:

expertise:
[
  {
    "title": "",
    "description": ""
  }
]

offers and courses:
[
  {
    "title": "",
    "description": "",
    "type": "",
    "price": "",
    "cta_text": "",
    "cta_link": ""
  }
]

benefits:
[
  {
    "title": "",
    "description": ""
  }
]

testimonials:
[
  {
    "quote": "",
    "name": "",
    "role": ""
  }
]

results:
[
  {
    "metric": "",
    "label": "",
    "description": ""
  }
]

social_links:
[
  {
    "platform": "",
    "url": ""
  }
]

section_titles example:
{
  "expertise": "",
  "offers": "",
  "benefits": "",
  "testimonials": "",
  "results": "",
  "courses": "",
  "contact": ""
}

Generate content that fits the actual business.
Do not fill missing factual information with fictional claims.
`;

  const response = await fetch(
    SARVAM_URL,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey
      },

      body: JSON.stringify({

        model: "sarvam-105b",

        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content:
              "COMPANY INFORMATION:\n\n" +
              companyContent
          }
        ],

        temperature: 0.3,

        max_tokens: 3500,

        response_format: {
          type: "json_object"
        }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `Sarvam API error: ${JSON.stringify(result)}`
    );
  }

  const rawContent =
    result.choices?.[0]?.message?.content;

  if (!rawContent) {
    throw new Error(
      "Sarvam returned an empty response."
    );
  }

  let parsed;

  try {

    parsed = JSON.parse(rawContent);

  } catch {

    throw new Error(
      "Sarvam returned invalid JSON."
    );
  }

  return parsed;
}


// ==========================================
// VALIDATE GENERATED WEBSITE DATA
// ==========================================

function validateWebsiteData(data) {

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new Error(
      "Invalid WEBSITE_DATA received from Sarvam."
    );
  }

  const stringFields = [
    "business_name",
    "creator_name",
    "business_description",
    "target_audience",
    "hero_headline",
    "hero_description",
    "primary_cta_text",
    "primary_cta_link",
    "secondary_cta_text",
    "secondary_cta_link",
    "about_title",
    "about_description",
    "contact_email",
    "form_endpoint"
  ];

  const arrayFields = [
    "expertise",
    "offers",
    "benefits",
    "testimonials",
    "results",
    "courses",
    "social_links"
  ];

  const output = {};

  // Normalize string fields
  for (const field of stringFields) {

    output[field] =
      typeof data[field] === "string"
        ? data[field].slice(0, 3000)
        : "";
  }

  // Normalize arrays
  for (const field of arrayFields) {

    output[field] =
      Array.isArray(data[field])
        ? data[field].slice(0, 20)
        : [];
  }

  // Brand colors
  const colors = data.brand_colors || {};

  output.brand_colors = {
    primary: safeColor(colors.primary, "#111111"),
    accent: safeColor(colors.accent, "#D6FF00"),
    background: safeColor(colors.background, "#FFFFFF"),
    text: safeColor(colors.text, "#111111")
  };

  // Section titles
  output.section_titles =
    data.section_titles &&
    typeof data.section_titles === "object" &&
    !Array.isArray(data.section_titles)
      ? data.section_titles
      : {};

  return output;
}


// ==========================================
// COLOR VALIDATION
// ==========================================

function safeColor(value, fallback) {

  if (typeof value !== "string") {
    return fallback;
  }

  const color = value.trim();

  if (
    /^#[0-9a-fA-F]{6}$/.test(color) ||
    /^#[0-9a-fA-F]{3}$/.test(color)
  ) {
    return color;
  }

  return fallback;
}


// ==========================================
// GITHUB HEADERS
// ==========================================

function githubHeaders(token) {

  return {

    "Authorization": `Bearer ${token}`,

    "Accept": "application/vnd.github+json",

    "X-GitHub-Api-Version": "2022-11-28"

  };
}


// ==========================================
// BASE64 DECODE
// ==========================================

function decodeBase64(base64) {

  const clean = base64.replace(/\s/g, "");

  const binary = atob(clean);

  const bytes = Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}


// ==========================================
// BASE64 ENCODE
// ==========================================

function encodeBase64(text) {

  const bytes = new TextEncoder().encode(text);

  let binary = "";

  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {

    const chunk = bytes.subarray(
      i,
      i + chunkSize
    );

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}


// ==========================================
// JSON RESPONSE
// ==========================================

function jsonResponse(data, status = 200) {

  return new Response(
    JSON.stringify(data),

    {
      status,

      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json"
      }
    }
  );
}


// ==========================================
// CORS
// ==========================================

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin": "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type, Authorization",

    "Access-Control-Max-Age": "86400"

  };
        }
