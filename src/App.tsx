/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  Lightbulb, 
  BookOpen, 
  RefreshCcw, 
  Home, 
  ChevronRight,
  MessageSquare,
  Sparkles,
  Loader2,
  AlertCircle,
  HelpCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { mockQuestions } from './data/questions';
import { evaluateExplanation } from './services/geminiService';
import { Question, QuizStep, Chapter } from './types';

// --- Constants ---

const EVALUATION_MESSAGES = [
  "AI 老师正在阅读你的解释...",
  "正在分析语法逻辑...",
  "正在比对核心关键词...",
  "正在组织反馈语言...",
  "即将给出批改结果..."
];

// --- Components ---

const Field = ({ content, fieldName }: { content: string; fieldName: string }) => (
  <span data-field={fieldName}>{content}</span>
);

export default function App() {
  // --- State ---
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<QuizStep>('question');
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const [userExplanation, setUserExplanation] = useState('');
  const [aiFeedback, setAiFeedback] = useState<{ status: string; comment: string } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [hintLevel, setHintLevel] = useState(0); // 0: none, 1: concept, 2: clue, 3: template
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [evalMessageIndex, setEvalMessageIndex] = useState(0);
  const [completedQuestions, setCompletedQuestions] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('grammarflow_progress');
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load progress', e);
      }
    }
    return new Set();
  });

  const [failedQuestionIds, setFailedQuestionIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('grammarflow_failed');
    if (saved) {
      try {
        return new Set(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load errors', e);
      }
    }
    return new Set();
  });

  // --- Persistence ---
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isEvaluating) {
      setEvalMessageIndex(0);
      interval = setInterval(() => {
        setEvalMessageIndex(prev => (prev + 1) % EVALUATION_MESSAGES.length);
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [isEvaluating]);

  useEffect(() => {
    localStorage.setItem('grammarflow_progress', JSON.stringify(Array.from(completedQuestions)));
  }, [completedQuestions]);

  useEffect(() => {
    localStorage.setItem('grammarflow_failed', JSON.stringify(Array.from(failedQuestionIds)));
  }, [failedQuestionIds]);

  // --- Derived Data ---
  const chapters = useMemo(() => {
    const map = new Map<string, Chapter & { completedCount: number }>();
    mockQuestions.forEach(q => {
      if (!map.has(q.chapterId)) {
        map.set(q.chapterId, {
          id: q.chapterId,
          name: q.chapterName,
          questionIds: [],
          completedCount: 0
        });
      }
      const chapter = map.get(q.chapterId)!;
      chapter.questionIds.push(q.id);
      if (completedQuestions.has(q.id)) {
        chapter.completedCount++;
      }
    });
    return Array.from(map.values());
  }, [completedQuestions, failedQuestionIds]);

  const filteredQuestions = useMemo(() => {
    if (!currentChapterId) return [];
    return mockQuestions.filter(q => q.chapterId === currentChapterId);
  }, [currentChapterId]);

  const currentQuestion = filteredQuestions[currentIndex];
  const currentChapter = chapters.find(c => c.id === currentChapterId);
  const remainingRedDots = currentChapter?.questionIds.filter(id => failedQuestionIds.has(id)).length || 0;

  // Confetti effect when mastering a chapter
  useEffect(() => {
    if (step === 'wrapUp' && currentChapterId) {
      const currentChapter = chapters.find(c => c.id === currentChapterId);
      const isMastered = currentChapter && currentChapter.completedCount >= currentChapter.questionIds.length && currentChapter.questionIds.length > 0;
      
      if (isMastered) {
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval: any = setInterval(function() {
          const timeLeft = animationEnd - Date.now();

          if (timeLeft <= 0) {
            return clearInterval(interval);
          }

          const particleCount = 50 * (timeLeft / duration);
          confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
          confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
      }
    }
  }, [step, currentChapterId, chapters]);

  // --- Handlers ---
  const handleStartChapter = (id: string, isReview: boolean = false, startIndex: number = 0) => {
    setCurrentChapterId(id);
    setCurrentIndex(startIndex);
    setStep('question');
    resetQuestionState();
    setIsReviewMode(isReview);
  };

  const resetQuestionState = () => {
    setUserAnswer(null);
    setUserExplanation('');
    setAiFeedback(null);
    setHintLevel(0);
    setConsecutiveFailures(0);
  };

  const handleAnswer = (option: string) => {
    setUserAnswer(option);
    setStep('feedback');
    
    // Error Reinforcement: Add to failed list if wrong
    if (option !== currentQuestion.correctAnswer) {
      setFailedQuestionIds(prev => {
        const next = new Set(prev);
        next.add(currentQuestion.id);
        return next;
      });
      // Scaffolding: Increment hint level on failure
      setConsecutiveFailures(prev => {
        const next = prev + 1;
        if (next >= 1) setHintLevel(h => Math.min(h + 1, 3));
        return next;
      });
    } else {
      setConsecutiveFailures(0);
    }
  };

  const handleExplain = async () => {
    if (!userExplanation.trim()) return;
    
    setIsEvaluating(true);
    try {
      const result = await evaluateExplanation(
        userExplanation,
        currentQuestion,
        currentQuestion.passKeywords
      );
      setAiFeedback(result);
      if (result.status === 'pass') {
        setConsecutiveFailures(0);
        setCompletedQuestions(prev => {
          const next = new Set(prev);
          next.add(currentQuestion.id);
          return next;
        });

        // Remove from failed list if passed
        setFailedQuestionIds(prev => {
          const next = new Set(prev);
          next.delete(currentQuestion.id);
          return next;
        });
        
        // Auto-navigate to next question after a short delay
        setTimeout(() => {
          handleNextQuestion();
        }, 1500);
      } else if (result.status === 'fail' || result.status === 'partial') {
        // Add to failed list if explanation is weak or wrong
        setFailedQuestionIds(prev => {
          const next = new Set(prev);
          next.add(currentQuestion.id);
          return next;
        });
        // Scaffolding: Increment hint level on failure
        setConsecutiveFailures(prev => {
          const next = prev + 1;
          if (next >= 1) setHintLevel(h => Math.min(h + 1, 3));
          return next;
        });
      }
    } catch (error) {
      console.error(error);
      setAiFeedback({ status: 'fail', comment: '评价过程出现了一点小问题，请重试。' });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleNextQuestion = () => {
    if (isReviewMode) {
      const currentChapter = chapters.find(c => c.id === currentChapterId);
      const remainingFailedIds = currentChapter?.questionIds.filter(id => failedQuestionIds.has(id)) || [];
      
      if (remainingFailedIds.length > 0) {
        // Go to the next failed question
        const nextFailedIdx = filteredQuestions.findIndex(q => q.id === remainingFailedIds[0]);
        setCurrentIndex(nextFailedIdx);
        setStep('question');
        resetQuestionState();
      } else {
        // No more failed questions in this chapter
        setStep('wrapUp');
        setIsReviewMode(false);
      }
    } else {
      if (currentIndex < filteredQuestions.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setStep('question');
        resetQuestionState();
      } else {
        setStep('wrapUp');
      }
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setStep('question');
    resetQuestionState();
    setIsReviewMode(false);
  };

  const handleBackToHome = () => {
    setCurrentChapterId(null);
    setIsReviewMode(false);
  };

  const handleNextChapter = () => {
    const currentIdx = chapters.findIndex(c => c.id === currentChapterId);
    setIsReviewMode(false);
    if (currentIdx < chapters.length - 1) {
      handleStartChapter(chapters[currentIdx + 1].id);
    } else {
      handleBackToHome();
    }
  };

  // --- Render Helpers ---

  if (!currentChapterId) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] p-6 sm:p-12 font-sans text-[#1a1a1a]">
        <div className="max-w-4xl mx-auto">
          <header className="mb-12 text-center">
            <h1 className="text-4xl font-black tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
              GrammarFlow
            </h1>
            <p className="text-gray-500 font-medium">深度学习闭环 • 语法微课地图</p>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {chapters.map((chapter, idx) => {
              const isMastered = chapter.completedCount >= chapter.questionIds.length && chapter.questionIds.length > 0;
              const progressPercent = (chapter.completedCount / chapter.questionIds.length) * 100;
              const chapterFailedCount = chapter.questionIds.filter(id => failedQuestionIds.has(id)).length;

              return (
                <motion.button
                  key={chapter.id}
                  whileHover={{ scale: 1.02, translateY: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleStartChapter(chapter.id)}
                  className={cn(
                    "bg-white p-8 rounded-[32px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border text-left flex flex-col group relative overflow-hidden",
                    isMastered ? "border-blue-200 bg-blue-50/30" : "border-gray-100"
                  )}
                >
                  {/* Failed Count Badge - Priority over Mastered if errors exist */}
                  {chapterFailedCount > 0 ? (
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                        const firstFailedId = chapter.questionIds.find(id => failedQuestionIds.has(id));
                        const firstFailedIdx = mockQuestions.filter(q => q.chapterId === chapter.id).findIndex(q => q.id === firstFailedId);
                        handleStartChapter(chapter.id, true, firstFailedIdx);
                      }}
                      className="absolute top-0 right-0 bg-red-500 text-white px-3 py-1 rounded-bl-xl text-[9px] font-black uppercase tracking-wider flex items-center gap-1 z-10 shadow-sm cursor-pointer hover:bg-red-600 transition-colors"
                    >
                      <AlertCircle className="w-2.5 h-2.5" /> {chapterFailedCount} 待复练
                    </div>
                  ) : isMastered ? (
                    <motion.div 
                      initial={{ scale: 3, opacity: 0, rotate: 15 }}
                      animate={{ scale: 1, opacity: 1, rotate: 0 }}
                      transition={{ type: "spring", damping: 12, stiffness: 200 }}
                      className="absolute top-0 right-0 bg-blue-600 text-white px-4 py-1 rounded-bl-2xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 shadow-lg z-10"
                    >
                      <Sparkles className="w-3 h-3 animate-pulse" /> Mastered
                    </motion.div>
                  ) : null}

                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1 block">
                        Chapter {idx + 1}
                      </span>
                      <h3 className="text-xl font-bold group-hover:text-blue-600 transition-colors">{chapter.name}</h3>
                    </div>
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                      isMastered ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-300 group-hover:bg-blue-50 group-hover:text-blue-500"
                    )}>
                      {isMastered ? <CheckCircle2 className="w-6 h-6" /> : <ChevronRight className="w-6 h-6" />}
                    </div>
                  </div>

                  <div className="mt-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        Progress
                      </span>
                      <span className="text-[10px] font-bold text-blue-600">
                        {chapter.completedCount} / {chapter.questionIds.length}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        className="h-full bg-blue-600 rounded-full"
                      />
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] p-4 sm:p-8 font-sans text-[#1a1a1a]">
      {isReviewMode && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="review-bar fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-3 shadow-lg text-sm"
        >
          🔥 正在攻克错题：本站还剩 {remainingRedDots} 处迷雾待清扫 🔥
        </motion.div>
      )}
      <div className={cn("max-w-3xl mx-auto", isReviewMode && "pt-12")}>
        {/* Progress Bar */}
        <div className="mb-8 flex items-center gap-4">
          <button 
            onClick={handleBackToHome}
            className="p-2 hover:bg-white rounded-full transition-colors"
          >
            <Home className="w-5 h-5 text-gray-400" />
          </button>
          <div className="flex-1 flex gap-2 overflow-x-auto py-2 no-scrollbar">
            {filteredQuestions.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentIndex(idx);
                  setStep('question');
                  resetQuestionState();
                }}
                className={cn(
                  "shrink-0 w-9 h-9 rounded-xl text-xs font-bold flex items-center justify-center transition-all duration-200 relative",
                  idx === currentIndex ? "bg-blue-600 text-white shadow-lg shadow-blue-100 scale-110" : 
                  completedQuestions.has(filteredQuestions[idx].id) ? "bg-green-50 text-green-600 border border-green-100" :
                  idx < currentIndex ? "bg-blue-50 text-blue-600 border border-blue-100" : 
                  "bg-white border border-gray-100 text-gray-400 hover:border-blue-200 hover:text-blue-400"
                )}
              >
                {idx + 1}
                {completedQuestions.has(filteredQuestions[idx].id) && idx !== currentIndex && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                    <CheckCircle2 className="w-2 h-2 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {currentIndex + 1} / {filteredQuestions.length}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Question */}
          {step === 'question' && (
            <motion.div 
              key="question"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="bg-white rounded-[40px] p-8 sm:p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100"
            >
              <div className="mb-10">
                <span className="inline-block px-4 py-1.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold uppercase tracking-widest mb-6">
                  {currentQuestion.grammarPoint}
                </span>
                <h2 className="text-3xl sm:text-4xl font-bold leading-tight">
                  <Field content={currentQuestion.stem} fieldName="stem" />
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {currentQuestion.options.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(option)}
                    className="group flex items-center justify-between p-6 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
                  >
                    <span className="text-lg font-bold group-hover:text-blue-700">{option}</span>
                    <div className="w-8 h-8 rounded-full border-2 border-gray-100 group-hover:border-blue-500 flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 2: Feedback */}
          {step === 'feedback' && (
            <motion.div 
              key="feedback"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <div className={cn(
                "rounded-[40px] p-8 sm:p-12 border-2 shadow-xl",
                userAnswer === currentQuestion.correctAnswer 
                  ? "bg-green-50 border-green-100" 
                  : "bg-red-50 border-red-100"
              )}>
                <div className="flex items-center gap-4 mb-6">
                  {userAnswer === currentQuestion.correctAnswer ? (
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                  ) : (
                    <XCircle className="w-10 h-10 text-red-600" />
                  )}
                  <h3 className={cn(
                    "text-2xl font-bold",
                    userAnswer === currentQuestion.correctAnswer ? "text-green-800" : "text-red-800"
                  )}>
                    {userAnswer === currentQuestion.correctAnswer 
                      ? <Field content={currentQuestion.correctTitle} fieldName="correctTitle" />
                      : <Field content={currentQuestion.incorrectTitle} fieldName="incorrectTitle" />
                    }
                  </h3>
                </div>

                <div className="bg-white/60 rounded-3xl p-6 backdrop-blur-sm border border-white/40">
                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                    <BookOpen className="w-4 h-4" /> <Field content={currentQuestion.explanationTitle} fieldName="explanationTitle" />
                  </h4>
                  <p className="text-lg leading-relaxed font-medium">
                    <Field content={currentQuestion.explanationSummary} fieldName="explanationSummary" />
                  </p>
                </div>

                {userAnswer === currentQuestion.correctAnswer ? (
                  <button
                    onClick={() => setStep('explain')}
                    className="mt-10 w-full py-6 bg-blue-600 text-white rounded-2xl font-bold text-xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-3 active:scale-[0.98]"
                  >
                    进入解释挑战 <ArrowRight className="w-6 h-6" />
                  </button>
                ) : (
                  <button
                    onClick={() => setStep('question')}
                    className="mt-10 w-full py-6 bg-red-600 text-white rounded-2xl font-bold text-xl hover:bg-red-700 transition-all shadow-xl shadow-red-100 flex items-center justify-center gap-3 active:scale-[0.98]"
                  >
                    重新尝试 <RefreshCcw className="w-6 h-6" />
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* Step 3: Explain Challenge */}
          {step === 'explain' && (
            <motion.div 
              key="explain"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-[40px] p-8 sm:p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold">
                    <Field content={currentQuestion.explainTitle} fieldName="explainTitle" />
                  </h3>
                </div>

                <div className="bg-gray-50 rounded-3xl p-6 mb-8 border border-gray-100">
                  <p className="text-gray-600 font-medium leading-relaxed">
                    <Field content={currentQuestion.explainPrompt} fieldName="explainPrompt" />
                  </p>
                </div>

                <div className="relative">
                  <textarea
                    value={userExplanation}
                    onChange={(e) => setUserExplanation(e.target.value)}
                    placeholder={currentQuestion.explainPlaceholder}
                    className="w-full h-40 p-6 bg-gray-50 rounded-3xl border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none text-lg resize-none"
                  />
                  {isEvaluating && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute inset-0 bg-white/80 backdrop-blur-md rounded-3xl flex flex-col items-center justify-center gap-6 z-10"
                    >
                      <div className="relative">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                        <motion.div
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                          className="absolute inset-0 bg-blue-100 rounded-full -z-10 blur-xl opacity-50"
                        />
                      </div>
                      <div className="h-6 flex items-center justify-center">
                        <AnimatePresence mode="wait">
                          <motion.p
                            key={evalMessageIndex}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="text-sm font-bold text-blue-600 uppercase tracking-widest"
                          >
                            {EVALUATION_MESSAGES[evalMessageIndex]}
                          </motion.p>
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* AI Feedback */}
                {aiFeedback && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className={cn(
                      "mt-6 p-6 rounded-3xl border-2",
                      aiFeedback.status === 'pass' ? "bg-green-50 border-green-100" : 
                      aiFeedback.status === 'partial' ? "bg-orange-50 border-orange-100" :
                      "bg-red-50 border-red-100"
                    )}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      {aiFeedback.status === 'pass' ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : 
                       aiFeedback.status === 'partial' ? <AlertCircle className="w-5 h-5 text-orange-600" /> :
                       <AlertCircle className="w-5 h-5 text-red-600" />}
                      <span className={cn(
                        "font-bold uppercase tracking-widest text-[10px]",
                        aiFeedback.status === 'pass' ? "text-green-600" : 
                        aiFeedback.status === 'partial' ? "text-orange-600" :
                        "text-red-600"
                      )}>
                        {aiFeedback.status === 'pass' ? '挑战通过' : 
                         aiFeedback.status === 'partial' ? '仍需完善' : 
                         aiFeedback.status === 'error' ? '无效输入' : '挑战未通过'}
                      </span>
                    </div>
                    <p className="text-gray-800 font-medium leading-relaxed">{aiFeedback.comment}</p>
                  </motion.div>
                )}

                <div className="mt-10 flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={handleExplain}
                    disabled={isEvaluating || !userExplanation.trim()}
                    className="flex-1 py-6 bg-blue-600 text-white rounded-2xl font-bold text-xl hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-all shadow-xl shadow-blue-100 active:scale-[0.98]"
                  >
                    <Field content={currentQuestion.submitExplainBtnLabel} fieldName="submitExplainBtnLabel" />
                  </button>
                  
                  {aiFeedback?.status === 'pass' && (
                    <button
                      onClick={handleNextQuestion}
                      className="flex-1 py-6 bg-[#1a1a1a] text-white rounded-2xl font-bold text-xl hover:bg-gray-800 transition-all shadow-xl shadow-gray-200 flex items-center justify-center gap-3 active:scale-[0.98]"
                    >
                      <Field content={currentQuestion.nextQuestionBtnLabel} fieldName="nextQuestionBtnLabel" /> <ArrowRight className="w-6 h-6" />
                    </button>
                  )}

                  {/* Skip Button - Safety Valve after 3 failures */}
                  {consecutiveFailures >= 3 && aiFeedback?.status !== 'pass' && (
                    <button
                      onClick={handleNextQuestion}
                      className="flex-1 py-6 bg-gray-100 text-gray-500 rounded-2xl font-bold text-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
                    >
                      暂时跳过 <ArrowRight className="w-6 h-6" />
                    </button>
                  )}
                </div>
              </div>

              {/* Scaffolding / Hints */}
              <div className="bg-white rounded-[40px] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" /> <Field content={currentQuestion.scaffoldLabel} fieldName="scaffoldLabel" />
                  </h4>
                  {hintLevel < 3 && (
                    <button 
                      onClick={() => setHintLevel(prev => prev + 1)}
                      className="text-xs font-bold text-blue-600 hover:underline"
                    >
                      <Field content={currentQuestion.getHintBtnLabel} fieldName="getHintBtnLabel" />
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {hintLevel >= 1 && (
                    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-4">
                      <span className="shrink-0 w-16 text-[10px] font-bold text-gray-300 uppercase mt-1">
                        <Field content={currentQuestion.conceptLabel} fieldName="conceptLabel" />
                      </span>
                      <p className="text-sm font-medium text-gray-600">{currentQuestion.hintLevel1Concepts}</p>
                    </motion.div>
                  )}
                  {hintLevel >= 2 && (
                    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-4">
                      <span className="shrink-0 w-16 text-[10px] font-bold text-gray-300 uppercase mt-1">
                        <Field content={currentQuestion.clueLabel} fieldName="clueLabel" />
                      </span>
                      <p className="text-sm font-medium text-gray-600">{currentQuestion.hintLevel2Clues}</p>
                    </motion.div>
                  )}
                  {hintLevel >= 3 && (
                    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-4">
                      <span className="shrink-0 w-16 text-[10px] font-bold text-gray-300 uppercase mt-1">
                        <Field content={currentQuestion.templateLabel} fieldName="templateLabel" />
                      </span>
                      <p className="text-sm font-medium text-gray-600 italic">{currentQuestion.hintLevel3Template}</p>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4: Wrap Up */}
          {step === 'wrapUp' && (
            <motion.div 
              key="wrapUp"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-[40px] p-8 sm:p-12 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100"
            >
              <div className="text-center mb-10 relative">
                {/* Mastered Badge in Wrap Up */}
                {(() => {
                  const currentChapter = chapters.find(c => c.id === currentChapterId);
                  const isMastered = currentChapter && currentChapter.completedCount >= currentChapter.questionIds.length && currentChapter.questionIds.length > 0;
                  return isMastered && (
                    <motion.div 
                      initial={{ scale: 0, rotate: -20, y: 20 }}
                      animate={{ scale: 1, rotate: 0, y: 0 }}
                      transition={{ 
                        type: "spring", 
                        damping: 10, 
                        stiffness: 100,
                        delay: 0.2
                      }}
                      className="absolute -top-12 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full text-sm font-black uppercase tracking-[0.2em] shadow-xl shadow-blue-200 flex items-center gap-2 z-20"
                    >
                      <Sparkles className="w-4 h-4 animate-spin-slow" /> Mastered
                    </motion.div>
                  );
                })()}
                <div className="inline-block p-6 bg-blue-50 rounded-full mb-6">
                  <CheckCircle2 className="w-12 h-12 text-blue-600" />
                </div>
                <h3 className="text-3xl font-bold">
                  <Field content={currentQuestion.wrapUpTitle} fieldName="wrapUpTitle" />
                </h3>
              </div>

              <div className="bg-blue-600 rounded-[32px] p-10 mb-12 relative overflow-hidden shadow-xl shadow-blue-100">
                <div className="absolute top-0 right-0 p-6 opacity-10">
                  <BookOpen className="w-32 h-32 text-white" />
                </div>
                <h4 className="text-blue-100 font-bold mb-4 flex items-center gap-2 text-sm uppercase tracking-widest">
                  <Lightbulb className="w-4 h-4" /> <Field content={currentQuestion.wrapUpPrompt} fieldName="wrapUpPrompt" />
                </h4>
                <p className="text-white text-xl leading-relaxed font-medium relative z-10">
                  <Field content={currentQuestion.wrapUpRule} fieldName="wrapUpRule" />
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {(() => {
                  const currentChapter = chapters.find(c => c.id === currentChapterId);
                  const chapterFailedIds = currentChapter?.questionIds.filter(id => failedQuestionIds.has(id)) || [];
                  
                  if (chapterFailedIds.length > 0) {
                    return (
                      <button
                        onClick={() => {
                          const firstFailedId = currentChapter?.questionIds.find(id => failedQuestionIds.has(id));
                          const firstFailedIdx = filteredQuestions.findIndex(q => q.id === firstFailedId);
                          handleStartChapter(currentChapterId!, true, firstFailedIdx);
                        }}
                        className="w-full py-6 bg-red-600 text-white rounded-2xl font-bold text-xl hover:bg-red-700 transition-all shadow-xl shadow-red-100 flex items-center justify-center gap-3 active:scale-[0.98]"
                      >
                        优先重练本章错题 ({chapterFailedIds.length}) <RefreshCcw className="w-6 h-6" />
                      </button>
                    );
                  }
                  return null;
                })()}

                <button
                  onClick={handleNextChapter}
                  className="w-full py-6 bg-blue-600 text-white rounded-2xl font-bold text-xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-3 active:scale-[0.98]"
                >
                  进入下一章 <ArrowRight className="w-6 h-6" />
                </button>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={handleRestart}
                    className="py-6 border-2 border-[#1a1a1a] text-[#1a1a1a] rounded-2xl font-bold text-lg hover:bg-gray-50 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    <RefreshCcw className="w-5 h-5" /> 重练本章
                  </button>
                  <button
                    onClick={handleBackToHome}
                    className="py-6 bg-gray-100 text-gray-600 rounded-2xl font-bold text-lg hover:bg-gray-200 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  >
                    <Home className="w-5 h-5" /> 返回地图
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="mt-16 text-center">
          <p className="text-[10px] text-gray-300 font-bold tracking-[0.3em] uppercase">
            专为深度学习设计 • GrammarFlow v1.2
          </p>
        </footer>
      </div>
    </div>
  );
}

// --- Utils ---
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
