import { NextResponse } from "next/server";

export async function GET() {
  try {
    // 1. Point to your isolated Docker Python Flask Service explicitly via IPv4
    const response = await fetch("http://127.0.0.1:5001/api/rate", { 
      cache: 'no-store' 
    });

    if (!response.ok) {
        throw new Error(`Flask Service error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    // 🔍 ENHANCED LOGGING FOR TERMINAL DIAGNOSIS
    if (error instanceof Error) {
        console.error("❌ RATE PROXY FAILURE:", error.message);
    } else {
        console.error("❌ RATE PROXY FAILURE: Unknown Error", error);
    }
    
    return NextResponse.json(
      { success: false, error: "Rate microservice is currently unreachable" }, 
      { status: 503 }
    );
  }
}
