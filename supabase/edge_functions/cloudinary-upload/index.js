// supabase/edge_functions/cloudinary-upload/index.js
// Deno-compatible Supabase Edge Function to process secure base64 image uploads to Cloudinary storage

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CLOUDINARY_CLOUD_NAME = Deno.env.get("CLOUDINARY_CLOUD_NAME") || "";
const CLOUDINARY_UPLOAD_PRESET = Deno.env.get("CLOUDINARY_UPLOAD_PRESET") || "";

serve(async (req) => {
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    });
  }

  try {
    const { base64Image, folder } = await req.json();

    if (!base64Image) {
      throw new Error("Missing parameter 'base64Image'");
    }

    // Prepare multipart form data payload
    const formData = new FormData();
    formData.append("file", base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}`);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    if (folder) {
      formData.append("folder", folder);
    }

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      {
        method: "POST",
        body: formData,
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || "Failed to upload image to Cloudinary");
    }

    return new Response(JSON.stringify({ success: true, url: result.secure_url }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 200,
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      status: 400,
    });
  }
});
