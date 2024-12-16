#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tavily } from '@tavily/core';
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    TextContent
} from '@modelcontextprotocol/sdk/types.js';

// Check for API key
const API_KEY = process.env.TAVILY_API_KEY;
if (!API_KEY) {
    console.error("TAVILY_API_KEY environment variable not found");
    process.exit(1);
}

// Initialize Tavily client
const tvly = tavily({ apiKey: API_KEY });

// Initialize MCP server
const server = new Server(
    { 
        name: "tavily-search-server", 
        version: "0.1.0" 
    }, 
    { 
        capabilities: { 
            resources: {}, 
            tools: {} 
        } 
    }
);

// Process search results based on search type
async function processSearchResults(results: any, type: string): Promise<TextContent> {
    if (!results) {
        return {
            type: "text",
            text: "No results were found for your query. Please try a different search term."
        };
    }

    const responseText: string[] = [];

    switch (type) {
        case "code":
            responseText.push("Code Examples & Implementation:\n");
            if (results.answer) {
                responseText.push("Overview:");
                responseText.push(results.answer + "\n");
            }
            
            if (results.results && Array.isArray(results.results)) {
                results.results.forEach((result: any, index: number) => {
                    responseText.push(`Example ${index + 1}:`);
                    responseText.push(`Source: ${result.url}`);
                    
                    if (result.rawContent) {
                        const codeBlocks = extractCodeBlocks(result.rawContent);
                        if (codeBlocks.length > 0) {
                            codeBlocks.forEach(block => {
                                responseText.push("\nCode:");
                                responseText.push(block.trim());
                            });
                        }
                    }
                    
                    // Include the relevant content section
                    if (result.content) {
                        responseText.push("\nDescription:");
                        responseText.push(result.content);
                    }
                    responseText.push(""); // Add spacing between examples
                });
            }
            break;

        case "docs":
            responseText.push("Technical Documentation:\n");
            if (results.answer) {
                responseText.push("Quick Reference:");
                responseText.push(results.answer + "\n");
            }
            if (results.results && Array.isArray(results.results)) {
                results.results.forEach((result: any) => {
                    responseText.push(result.title);
                    responseText.push(`Source: ${result.url}`);
                    
                    if (result.content) {
                        responseText.push("\nDetails:");
                        responseText.push(result.content);
                    }
                    responseText.push("");
                });
            }
            break;

        case "debug":
            responseText.push("Debugging Solutions:\n");
            if (results.answer) {
                responseText.push("Quick Solution:");
                responseText.push(results.answer + "\n");
            }
            if (results.results && Array.isArray(results.results)) {
                results.results.forEach((result: any, index: number) => {
                    responseText.push(`Solution ${index + 1}:`);
                    responseText.push(`Context: ${result.title}`);
                    responseText.push(`Source: ${result.url}`);
                    
                    if (result.content) {
                        responseText.push("\nFix:");
                        responseText.push(result.content);
                    }
                    responseText.push("");
                });
            }
            break;

        case "learn":
            responseText.push("Learning Resources:\n");
            if (results.answer) {
                responseText.push("Overview:");
                responseText.push(results.answer + "\n");
            }
            if (results.results && Array.isArray(results.results)) {
                results.results.forEach((result: any) => {
                    responseText.push(result.title);
                    responseText.push(`Source: ${result.url}`);
                    
                    if (result.content) {
                        responseText.push("\nKey Points:");
                        responseText.push(result.content);
                    }
                    responseText.push("");
                });
            }
            break;
    }

    if (responseText.length === 0) {
        return {
            type: "text",
            text: "The search was completed but no relevant information was found. Please try refining your query."
        };
    }

    return {
        type: "text",
        text: responseText.join("\n")
    };
}

// Helper function to extract code blocks from content
function extractCodeBlocks(content: string): string[] {
    const blocks: string[] = [];
    
    // Match code blocks with or without language specification
    const codeBlockRegex = /```(?:\w+\n)?([\s\S]*?)```|`([^`]+)`/g;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
        const block = match[1] || match[2];
        if (block && block.trim()) {
            blocks.push(block.trim());
        }
    }
    
    // If no code blocks found, try to extract code-like content
    if (blocks.length === 0) {
        const codeLikePatterns = [
            /(?:const|let|var|function|class|import|export)[\s\S]*?(?:;|\})/g,
            /(?:useEffect|useState|useCallback|useMemo)\([\s\S]*?\)(?:;|\})/g,
            /<[\w\s="']+>[\s\S]*?<\/[\w]+>/g
        ];

        for (const pattern of codeLikePatterns) {
            const matches = content.match(pattern);
            if (matches) {
                blocks.push(...matches);
            }
        }
    }
    
    return blocks;
}

// Set up available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "search",
            description: "AI-powered technical search optimized for coding assistance. Use this to find code examples, documentation, debug solutions, and learning resources.",
            inputSchema: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query - be specific about programming language, framework, or error message"
                    },
                    type: {
                        type: "string",
                        description: "Type of technical search needed",
                        enum: ["code", "docs", "debug", "learn"],
                        default: "code"
                    }
                },
                required: ["query"]
            }
        }
    ]
}));

// Set up available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
        {
            uri: "websearch://query=`react hooks useEffect example`,type=`code`",
            name: "Code search example for React hooks",
            mimeType: "application/json",
            description: "Find code examples and implementation patterns using Tavily API"
        }
    ]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== "search") {
        return {
            content: [
                {
                    type: "text",
                    text: `Error: Unknown tool '${name}'. Only 'search' is supported.`
                }
            ]
        };
    }

    if (!args || typeof args !== 'object' || !('query' in args)) {
        return {
            content: [
                {
                    type: "text",
                    text: "Error: Invalid arguments. A 'query' parameter is required."
                }
            ]
        };
    }

    try {
        const query = args.query as string;
        const type = (args.type || "code") as "code" | "docs" | "debug" | "learn";

        let results;
        const baseOptions = {
            searchDepth: "advanced" as "advanced" | "basic",
            includeAnswer: true,
            includeRawContent: true
        };

        switch (type) {
            case "code":
                results = await tvly.search(query, {
                    ...baseOptions,
                    maxResults: 3
                });
                break;
            case "docs":
                results = await tvly.search(query, {
                    ...baseOptions,
                    maxResults: 2,
                    searchDepth: "basic" as "basic"
                });
                break;
            case "debug":
                results = await tvly.search(query, {
                    ...baseOptions,
                    maxResults: 5
                });
                break;
            case "learn":
                results = await tvly.search(query, {
                    ...baseOptions,
                    maxResults: 3,
                    searchDepth: "basic" as "basic"
                });
                break;
        }

        const processedResults = await processSearchResults(results, type);

        return {
            content: [processedResults]
        };
    } catch (error: any) {
        const errorMessage = error.message || String(error);
        console.error('Search error:', errorMessage);
        
        // Handle specific error cases
        if (errorMessage.toLowerCase().includes('api_key')) {
            return {
                content: [{
                    type: "text",
                    text: "Authentication error occurred. Please check the API key configuration."
                }]
            };
        } else if (errorMessage.toLowerCase().includes('rate limit')) {
            return {
                content: [{
                    type: "text",
                    text: "Rate limit exceeded. Please wait a moment before trying again."
                }]
            };
        }

        return {
            content: [{
                type: "text",
                text: `An unexpected error occurred during the search. Please try again later. Error: ${errorMessage}`
            }]
        };
    }
});

// Start the server
async function main() {
    console.log("Starting Tavily search server");
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.log("Server initialized and running");
    } catch (error) {
        console.error("Server failed to start:", error);
        process.exit(1);
    }
}

// Handle interrupts
process.on('SIGINT', async () => {
    console.log("Server shutdown requested");
    process.exit(0);
});

main().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
});
