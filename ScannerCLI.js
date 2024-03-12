#!/usr/bin/env node

const program = require('commander');
const fs = require('fs');
const path = require('path'); 
const SwiftScanner = require('./SwiftScanner');

// Set up the CLI program
program
    .version('1.0.0')
    .description('CLI for Swift Code Scanner');

    program
    .command('scan <filePath...>')
    .description('Scan Swift files and extract components')
    .option('-d, --design <design>', 'Specify design system modules (comma-separated)')
    .option('-e, --exclude <exclude>', 'Exclude folders (comma-separated)')
    .action(async (filePaths, cmd) => {
        // Parse design system modules and excluded folders
        const designSystemModules = cmd.design ? cmd.design.split(',') : [];
        const excludedFolders = cmd.exclude ? cmd.exclude.split(',') : [];

        // Initialize the SwiftScanner with design system modules
        let scanner;
        if (designSystemModules.length > 0) {
            console.log(`using desing systems: ${designSystemModules}`);
            scanner = new SwiftScanner(designSystemModules);
        } else {
            scanner = new SwiftScanner(); // Initialize without design system modules
        }

        // Initialize the scanner
        console.log('Initializing scanner...');
        await scanner.initialize();
        if (!fs.existsSync(scanner.datasetFilePath)) {
            console.log(`creating ${scanner.datasetFilePath}`)
            await scanner.generateDataset();
            await scanner.saveDataset();
        } else {
            console.log(`loading ${scanner.datasetFilePath}`);
            await scanner.loadDataset();
        }
        // Resolve current working directory to get absolute file paths
        const cwd = process.cwd();

        // Array to store paths where components are saved
        const savedPaths = [];


        // Scan each specified file recursively
        console.log('Scanning files...');
        for (const filePath of filePaths) {
            const absoluteFilePath = path.resolve(cwd, filePath);
            await scanner.scanFilesRecursively(absoluteFilePath, excludedFolders);
            savedPaths.push(scanner.codebaseComponentsPath);
        }
        
        scanner.saveCodebaseComponents();

        // Print scan completion message with saved paths
        console.log('Scan complete.');
        savedPaths.forEach(savedPath => {
            console.log(`Components saved to: ${savedPath}`);
        });
    });

// Command to get available SPM modules
program
    .command('modules')
    .description('Get available SPM modules')
    .action(async () => {
        const scanner = new SwiftScanner();
        await scanner.initialize();
        const availableModules = scanner.projectModulesList;
        if (availableModules.length > 0) {
            console.log("\nAvailable modules:\n");
            availableModules.forEach(module => {
                console.log(` - name: ${module.name}\n - path: ${module.path}\n`);
            });
        } else {
            console.log("No modules available.");
        }
    });


// Enhance help documentation for better usability
program.on('--help', () => {
    console.log('');
    console.log('Examples:');
    console.log('  $ scan-swift scan -d UIKit -e Tests Sources/MessageInputBar/MessageInputBar.swift');
    console.log('  $ scan-swift modules');
});

// Parse command line arguments
program.parse(process.argv);
