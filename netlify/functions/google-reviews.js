// netlify/functions/google-reviews.js
// Fetches Chef's Table Google reviews using Places API
// Requires GOOGLE_PLACES_API_KEY in Netlify environment variables
// Also requires GOOGLE_PLACE_ID — find yours at:
// https://developers.google.com/maps/documentation/places/web-service/place-id

exports.handler = async function () {
  const apiKey  = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID || 'ChIJ_REPLACE_WITH_YOUR_PLACE_ID';

  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews: [] })
    };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=reviews,rating,user_ratings_total&key=${apiKey}`;
    const res  = await fetch(url);
    const data = await res.json();

    if (data.status !== 'OK' || !data.result) {
      return { statusCode: 200, body: JSON.stringify({ reviews: [] }) };
    }

    // Filter to 4+ star reviews only, sort by most recent
    const reviews = (data.result.reviews || [])
      .filter(r => r.rating >= 4)
      .sort((a, b) => b.time - a.time)
      .slice(0, 8)
      .map(r => ({
        author_name:               r.author_name,
        rating:                    r.rating,
        text:                      r.text,
        relative_time_description: r.relative_time_description,
      }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // cache 1 hour
      },
      body: JSON.stringify({ reviews })
    };
  } catch (err) {
    console.error('Google Places error:', err);
    return { statusCode: 200, body: JSON.stringify({ reviews: [] }) };
  }
};
