import { NextResponse } from "next/server";
import { getCurrentRate } from "@/lib/services/rate/rate.service";

export async function GET() {
  try {
    const currentRate = await getCurrentRate();
    
    return NextResponse.json({
      success: true,
      data: currentRate
    });
    
  } catch (error) {
    console.error("RATE API ERROR:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch current energy rate" },
      { status: 500 }
    );
  }
}
