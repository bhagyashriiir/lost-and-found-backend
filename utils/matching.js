// Normalize text by converting to lowercase and removing special characters
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Used to compare descriptions and identify common words
function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean);
}

// Calculate number of common keywords between two descriptions
function intersectionCount(arr1, arr2) {
  const set2 = new Set(arr2);
  return arr1.filter((word) => set2.has(word)).length;
}

// Improves classification and matching accuracy for lost and found items
function detectCategory(report) {
  const text = normalizeText(
    `${report.itemName || ""} ${report.category || ""} ${report.description || ""}`
  );

  // Define keyword rules for identifying item categories
  const rules = [
    { category: "Wallet", keywords: ["wallet", "purse", "cardholder"] },
    { category: "Phone", keywords: ["phone", "iphone", "samsung", "mobile"] },
    { category: "Bag", keywords: ["bag", "backpack", "handbag", "luggage"] },
    { category: "Keys", keywords: ["key", "keys", "keychain"] },
    { category: "Passport", keywords: ["passport"] },
    { category: "Watch", keywords: ["watch"] },
    { category: "Laptop", keywords: ["laptop", "macbook"] },
    { category: "Earbuds", keywords: ["airpods", "earbuds", "headphones"] }
  ];

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.category;
    }
  }

  return report.category || "Other";
}

// Calculate similarity score based on item name and category
function getImageSimilarityScore(source, target) {
  const sourceName = normalizeText(source.itemName);
  const targetName = normalizeText(target.itemName);
  const sourceCategory = normalizeText(source.category);
  const targetCategory = normalizeText(target.category);

  if (sourceName && targetName && sourceName === targetName) return 24;
  if (sourceCategory && targetCategory && sourceCategory === targetCategory) return 18;
  return 8;
}

// Calculate overall similarity score between two reports
function scoreReports(source, target) {
  let score = 0;

  const sourceName = normalizeText(source.itemName);
  const targetName = normalizeText(target.itemName);

  const sourceCategory = normalizeText(source.category);
  const targetCategory = normalizeText(target.category);

  const sourceLocation = normalizeText(source.location);
  const targetLocation = normalizeText(target.location);

  const sourceVenue = normalizeText(source.venueType);
  const targetVenue = normalizeText(target.venueType);

  const sourceCityArea = normalizeText(source.cityArea);
  const targetCityArea = normalizeText(target.cityArea);

  const sourceDescTokens = tokenize(`${source.itemName} ${source.description} ${source.category}`);
  const targetDescTokens = tokenize(`${target.itemName} ${target.description} ${target.category}`);

  if (sourceCategory && targetCategory && sourceCategory === targetCategory) {  // Increase score when item categories match
    score += 26;
  }

  if (sourceName && targetName && sourceName === targetName) {
    score += 18;
  }

  score += getImageSimilarityScore(source, target);

  if (sourceVenue && targetVenue && sourceVenue === targetVenue) {
    score += 15;
  }

  if (sourceLocation && targetLocation && sourceLocation === targetLocation) {  // Increase score when location or venue matches
    score += 15;
  }

  if (sourceCityArea && targetCityArea && sourceCityArea === targetCityArea) {
    score += 10;
  }

  if (source.date && target.date && source.date === target.date) {
    score += 8;
  }

  if (source.time && target.time && source.time === target.time) {
    score += 4;
  }

  // Add score based on number of common keywords in descriptions
  const commonWords = intersectionCount(sourceDescTokens, targetDescTokens);
  score += Math.min(commonWords * 4, 20);

  return Math.min(score, 100);
}

// Identify possible matches between lost and found reports
function findPossibleMatches(newReport, allReports) {
  const oppositeType = newReport.type === "lost" ? "found" : "lost";

  return allReports
    .filter((report) => report.type === oppositeType && report.status !== "Resolved")
    .map((report) => {
      const confidence = scoreReports(newReport, report);
      return {
        reportId: report._id,
        itemName: report.itemName,
        category: report.category,
        location: report.location,
        cityArea: report.cityArea || "",
        venueType: report.venueType || "",
        confidence,
        imageSimilarityScore: getImageSimilarityScore(newReport, report)
      };
    })
    .filter((match) => match.confidence >= 35)  // Filter matches that meet minimum confidence threshold
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

// Check whether a new report is a duplicate of an existing report
function isDuplicate(newReport, existingReports) {
  return existingReports.some((report) => {
    if (report.type !== newReport.type) return false;
    const duplicateScore = scoreReports(newReport, report);
    return duplicateScore >= 75;  // Identify duplicate if similarity score exceeds threshold
  });
}

// Export matching and duplicate detection functions for use in report processing
module.exports = {
  detectCategory,
  scoreReports,
  findPossibleMatches,
  isDuplicate,
  getImageSimilarityScore
};